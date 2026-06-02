import { fetch, FormData } from "undici";
import { readFile } from "node:fs/promises";
import { callback } from "./callback.js";
import { fetchBundleInfo, downloadUrl } from "./api.js";

const WECHAT_FILE_LIMIT = 20 * 1024 * 1024;
const DEFAULT_WECHAT_KEY = process.env.WECHAT_WEBHOOK_KEY || "";

/**
 * Multi-channel WeChat webhook key map.
 * Set env `WECHAT_WEBHOOK_KEYS` to a JSON object like:
 *   {"sales":"<key1>","dev":"<key2>","alerts":"<key3>"}
 * Each value is the `key` query param from the WeChat Work webhook URL.
 */
function loadWebhookKeys(): Record<string, string> {
  const raw = process.env.WECHAT_WEBHOOK_KEYS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("WECHAT_WEBHOOK_KEYS는 객체(JSON)여야 합니다");
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch (e) {
    console.warn("[wechat] WECHAT_WEBHOOK_KEYS 파싱 실패:", (e as Error).message);
    return {};
  }
}

const WECHAT_WEBHOOK_KEYS: Record<string, string> = loadWebhookKeys();

function buildWebhookUrl(key: string): string {
  return `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`;
}

function resolveChannelKey(channel: string): string {
  const key = WECHAT_WEBHOOK_KEYS[channel];
  if (!key) {
    const available = Object.keys(WECHAT_WEBHOOK_KEYS);
    throw new Error(
      available.length
        ? `알 수 없는 위챗 채널 '${channel}'. 사용 가능: ${available.join(", ")}`
        : `위챗 채널 '${channel}'을(를) 찾을 수 없습니다. WECHAT_WEBHOOK_KEYS 환경변수를 설정하세요.`,
    );
  }
  return key;
}

function extractKey(url: string): string | null {
  try { return new URL(url).searchParams.get("key") || DEFAULT_WECHAT_KEY || null; }
  catch { return DEFAULT_WECHAT_KEY || null; }
}

function resolveWebhookUrl(jobWebhookUrl: string): string {
  if (jobWebhookUrl) return jobWebhookUrl;
  if (DEFAULT_WECHAT_KEY) return buildWebhookUrl(DEFAULT_WECHAT_KEY);
  return "";
}

/**
 * Send a plain text message to a named WeChat channel.
 * @param channel 'sales' | 'dev' | 'alerts' 등 WECHAT_WEBHOOK_KEYS의 키
 * @param message 전송할 텍스트
 */
export async function sendToWeChat(channel: string, message: string): Promise<void> {
  if (!channel || typeof channel !== "string") {
    throw new Error("channel은 비어있지 않은 문자열이어야 합니다");
  }
  if (!message || typeof message !== "string") {
    throw new Error("message는 비어있지 않은 문자열이어야 합니다");
  }
  const key = resolveChannelKey(channel);
  await sendJson(buildWebhookUrl(key), { msgtype: "text", text: { content: message } });
}

async function uploadMedia(key: string, filename: string, bytes: Buffer): Promise<string> {
  const fd = new FormData();
  fd.append("media", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), filename);
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
  zipBytes?: Buffer;
  zipPath?: string;
  zipSize?: number;
  zipFilename: string;
  zipUrl: string;
  itemCount: number;
}

export async function sendBundleToWeChat(input: WeChatSendInput): Promise<void> {
  const { zipFilename, zipUrl, orderNo, itemCount } = input;
  const zipSize = input.zipSize ?? input.zipBytes?.length ?? 0;
  const webhookUrl = resolveWebhookUrl(input.webhookUrl);
  if (!webhookUrl) throw new Error("webhook_url / WECHAT_WEBHOOK_KEY 미설정");
  const summary = `【발주 ZIP】\n작업번호: ${orderNo}\n수량: ${itemCount}건\n파일: ${zipFilename}\n크기: ${(zipSize / 1024 / 1024).toFixed(2)}MB`;
  const key = extractKey(webhookUrl);
  if (zipSize <= WECHAT_FILE_LIMIT && key) {
    const zipBytes = input.zipBytes ?? (input.zipPath ? await readFile(input.zipPath) : null);
    if (!zipBytes) throw new Error("ZIP 파일 데이터 없음");
    const mediaId = await uploadMedia(key, zipFilename, zipBytes);
    await sendJson(webhookUrl, { msgtype: "file", file: { media_id: mediaId } });
    await sendJson(webhookUrl, { msgtype: "text", text: { content: summary } });
  } else {
    const reason = !key ? "webhook key 없음" : `${(zipSize / 1024 / 1024).toFixed(1)}MB > 20MB`;
    await sendJson(webhookUrl, {
      msgtype: "text",
      text: { content: `${summary}\n(${reason} → 다운로드 링크 전송)\n${zipUrl}` },
    });
  }
}

/** Re-attempt WeChat delivery for a job that has bundle_zip_path set. */
export async function wechatResend(jobId: string): Promise<void> {
  let info;
  try {
    info = await fetchBundleInfo(jobId);
  } catch (e) {
    await callback({ jobId, status: "failed", error_message: `bundle info: ${(e as Error).message}` });
    return;
  }
  const { job, bundle_zip_view_url, bundle_zip_download_url } = info;
  if (!bundle_zip_download_url) {
    await callback({ jobId, status: "failed", error_message: "ZIP 다운로드 URL 없음" });
    return;
  }
  let bytes: Buffer;
  try {
    bytes = await downloadUrl(bundle_zip_download_url);
  } catch (e) {
    await callback({ jobId, status: "failed", error_message: `ZIP 다운로드 실패: ${(e as Error).message}` });
    return;
  }
  await callback({ jobId, status: "wechat", stage: "위챗 재전송 중", error_message: null });
  try {
    await sendBundleToWeChat({
      jobId,
      webhookUrl: job.webhook_url,
      orderNo: job.order_no,
      zipBytes: bytes,
      zipFilename: `${job.order_no}-bundle.zip`,
      zipUrl: bundle_zip_view_url || "",
      itemCount: job.progress_total ?? 0,
    });
    await callback({ jobId, status: "done", stage: "완료", bundle_zip_url: bundle_zip_view_url, error_message: null });
  } catch (e) {
    await callback({ jobId, status: "failed", error_message: `위챗 재전송 실패: ${(e as Error).message}` });
  }
}
