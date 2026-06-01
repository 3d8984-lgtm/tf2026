import { fetch, FormData, Blob } from "undici";
import { supa } from "./supabase.js";
import { callback } from "./callback.js";
import { signedUrl } from "./storage.js";

const WECHAT_FILE_LIMIT = 20 * 1024 * 1024;

function extractKey(url: string): string | null {
  try { return new URL(url).searchParams.get("key"); } catch { return null; }
}

async function uploadMedia(key: string, filename: string, bytes: Buffer): Promise<string> {
  const fd = new FormData();
  fd.append("media", new Blob([bytes], { type: "application/zip" }), filename);
  const r = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=${encodeURIComponent(key)}&type=file`,
    { method: "POST", body: fd as any },
  );
  const txt = await r.text();
  let data: any = {};
  try { data = JSON.parse(txt); } catch { throw new Error(`upload_media non-JSON: ${txt.slice(0, 200)}`); }
  if (data.errcode !== 0 || !data.media_id) {
    throw new Error(`upload_media ${data.errcode} ${data.errmsg || ""}`);
  }
  return data.media_id as string;
}

async function sendJson(url: string, payload: unknown): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  let data: any = {};
  try { data = JSON.parse(txt); } catch {/* ignore */}
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`wechat send ${data.errcode} ${data.errmsg || ""}`);
  }
}

export interface WeChatSendInput {
  jobId: string;
  webhookUrl: string;
  orderNo: string;
  zipBytes: Buffer;
  zipFilename: string;
  zipUrl: string;
  itemCount: number;
}

export async function sendBundleToWeChat(input: WeChatSendInput): Promise<void> {
  const { webhookUrl, zipBytes, zipFilename, zipUrl, orderNo, itemCount } = input;
  if (!webhookUrl) throw new Error("webhook_url 미설정");
  const summary = `【발주 ZIP】\n작업번호: ${orderNo}\n수량: ${itemCount}건\n파일: ${zipFilename}\n크기: ${(zipBytes.length / 1024 / 1024).toFixed(2)}MB`;
  const key = extractKey(webhookUrl);
  if (zipBytes.length <= WECHAT_FILE_LIMIT && key) {
    const mediaId = await uploadMedia(key, zipFilename, zipBytes);
    await sendJson(webhookUrl, { msgtype: "file", file: { media_id: mediaId } });
    await sendJson(webhookUrl, { msgtype: "text", text: { content: summary } });
  } else {
    const reason = !key ? "webhook key 없음" : `${(zipBytes.length / 1024 / 1024).toFixed(1)}MB > 20MB`;
    await sendJson(webhookUrl, {
      msgtype: "text",
      text: { content: `${summary}\n(${reason} → 다운로드 링크 전송)\n${zipUrl}` },
    });
  }
}

/** Re-attempt WeChat delivery for a job that has bundle_zip_path set. */
export async function wechatResend(jobId: string): Promise<void> {
  const { data: job, error } = await supa.from("order_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error || !job) {
    await callback({ jobId, status: "failed", error_message: `job not found: ${error?.message || "missing"}` });
    return;
  }
  if (!job.bundle_zip_path || !job.bundle_zip_url) {
    await callback({ jobId, status: "failed", error_message: "ZIP이 아직 생성되지 않음" });
    return;
  }
  const { data: blob, error: dlErr } = await supa.storage.from(process.env.STORAGE_BUCKET || "hologram-pdf").download(job.bundle_zip_path);
  if (dlErr || !blob) {
    await callback({ jobId, status: "failed", error_message: `ZIP 다운로드 실패: ${dlErr?.message || ""}` });
    return;
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const url = await signedUrl(job.bundle_zip_path);
  await callback({ jobId, status: "wechat", stage: "위챗 재전송 중", error_message: null });
  try {
    await sendBundleToWeChat({
      jobId,
      webhookUrl: job.webhook_url,
      orderNo: job.order_no,
      zipBytes: bytes,
      zipFilename: `${job.order_no}-bundle.zip`,
      zipUrl: url,
      itemCount: job.progress_total ?? 0,
    });
    await callback({ jobId, status: "done", stage: "완료", bundle_zip_url: url, error_message: null });
  } catch (e) {
    await callback({ jobId, status: "failed", error_message: `위챗 재전송 실패: ${(e as Error).message}` });
  }
}
