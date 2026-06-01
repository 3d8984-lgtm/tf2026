// Heat-transfer order finalizer.
// Generates a real ZIP bundle (작업지시서.pdf + images/*.png) and ships it to the
// WeChat Work group. ≤20MB → upload_media + file message. >20MB → signed URL text.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { zip } from "npm:fflate@0.8.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "hologram-pdf";
const WECHAT_FILE_LIMIT = 20 * 1024 * 1024; // 20MB

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: { jobId?: string; mode?: "resume" | "watchdog"; zipPath?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const authHeader = req.headers.get("Authorization") || "";
  const systemCall = req.headers.get("x-watchdog-secret") === SERVICE_ROLE_KEY
    || (body.mode === "watchdog" && req.headers.get("apikey") === ANON_KEY);

  if (!systemCall) {
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  if (body.mode === "watchdog") {
    await admin.rpc("requeue_stale_png_jobs", { _older_than: "30 seconds" });
    const { data: jobs, error } = await admin
      .from("outsource_order_jobs")
      .select("id")
      .eq("factory", "heat")
      .in("status", ["uploading", "finalizing", "failed"])
      .order("updated_at", { ascending: true })
      .limit(5);
    if (error) return json({ error: error.message }, 500);
    const results = [];
    for (const j of jobs || []) results.push(await processJob(admin, j.id));
    return json({ status: "watchdog", results }, 200);
  }

  if (!body.jobId || typeof body.jobId !== "string") return json({ error: "jobId required" }, 400);
  const result = await processJob(admin, body.jobId);
  return json(result, result.status === "failed" ? 500 : 200);
});

async function setJob(admin: any, jobId: string, patch: Record<string, unknown>) {
  await admin.from("outsource_order_jobs").update(patch).eq("id", jobId);
}

async function failJob(admin: any, jobId: string, message: string) {
  await setJob(admin, jobId, {
    status: "failed",
    stage: "실패",
    error_message: message.slice(0, 1000),
  });
  return { status: "failed", jobId, error: message };
}

async function downloadBytes(admin: any, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed (${path}): ${error?.message || "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

function extractWebhookKey(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("key");
  } catch { return null; }
}

async function wechatUploadMedia(webhookKey: string, filename: string, bytes: Uint8Array): Promise<string> {
  const fd = new FormData();
  fd.append("media", new Blob([bytes], { type: "application/zip" }), filename);
  const uploadUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=${encodeURIComponent(webhookKey)}&type=file`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  let resp: Response;
  try {
    resp = await fetch(uploadUrl, { method: "POST", body: fd, signal: ac.signal });
  } finally { clearTimeout(t); }
  const txt = await resp.text();
  let data: any = {};
  try { data = JSON.parse(txt); } catch { throw new Error(`upload_media non-JSON: ${txt.slice(0, 200)}`); }
  if (data.errcode !== 0 || !data.media_id) {
    throw new Error(`upload_media failed: ${data.errcode} ${data.errmsg || ""}`);
  }
  return data.media_id as string;
}

async function wechatSendJson(webhookUrl: string, payload: unknown): Promise<void> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const txt = await r.text();
    let data: any = {};
    try { data = JSON.parse(txt); } catch {/* ignore */}
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`wechat send failed: ${data.errcode} ${data.errmsg || ""}`);
    }
  } finally { clearTimeout(t); }
}

async function processJob(admin: any, jobId: string) {
  const { data: job, error: jobErr } = await admin
    .from("outsource_order_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) return failJob(admin, jobId, jobErr.message);
  if (!job) return { status: "missing", jobId };
  if (job.status === "done") return { status: "done", jobId, zip_url: job.zip_url };

  const folderName = job.order_no || jobId;

  try {
    await admin.rpc("requeue_stale_png_jobs", { _older_than: "30 seconds" });

    const { data: counts, error: countErr } = await admin
      .from("png_jobs")
      .select("status")
      .eq("job_id", jobId);
    if (countErr) throw new Error(countErr.message);
    const total = (counts || []).length || job.total_pngs || 0;
    const completed = (counts || []).filter((r: any) => r.status === "completed").length;
    const failed = (counts || []).filter((r: any) => r.status === "failed").length;

    await setJob(admin, jobId, {
      status: completed >= total && total > 0 ? "finalizing" : "uploading",
      uploaded_pngs: completed,
      total_pngs: Math.max(total, job.total_pngs || 0),
      error_message: null,
      stage: completed >= total && total > 0
        ? "ZIP 묶음 생성 중"
        : `PNG 대기/업로드 진행 ${completed}/${Math.max(total, job.total_pngs || 0)}${failed ? ` · 실패 ${failed}` : ""}`,
    });

    if (total === 0 || completed < total) {
      return { status: "waiting_png", jobId, completed, total, failed };
    }

    const { data: files, error: filesErr } = await admin
      .from("png_jobs")
      .select("item_id, file_url")
      .eq("job_id", jobId)
      .eq("status", "completed")
      .order("item_id", { ascending: true });
    if (filesErr) throw new Error(filesErr.message);
    if ((files || []).length !== total) {
      throw new Error(`PNG 업로드 미완료: completed=${(files || []).length}/${total}`);
    }

    // --- Build ZIP: 작업지시서.pdf + images/*.png ---
    await setJob(admin, jobId, { stage: `ZIP 생성 준비 (${files.length}장)` });

    const pdfPath = `orders/heat-transfer-jobs/${jobId}/__work_order.pdf`;
    const zipEntries: Record<string, [Uint8Array, { level: number }]> = {};

    try {
      const pdfBytes = await downloadBytes(admin, pdfPath);
      zipEntries["작업지시서.pdf"] = [pdfBytes, { level: 0 }];
    } catch (e) {
      console.warn(`[job ${jobId}] 작업지시서 PDF 다운로드 실패 - 계속 진행`, (e as Error).message);
    }

    const pad = String(files.length).length;
    let downloaded = 0;
    const CONCURRENCY = 6;
    const queue = [...files];
    async function worker() {
      while (queue.length) {
        const f = queue.shift();
        if (!f) break;
        const bytes = await downloadBytes(admin, f.file_url);
        const baseName = (f.file_url.split("/").pop() || `${f.item_id}.png`).replace(/[\\/]/g, "_");
        const idxStr = String(f.item_id).padStart(pad, "0");
        const name = `images/${idxStr}_${baseName}`;
        zipEntries[name] = [bytes, { level: 0 }];
        downloaded++;
        if (downloaded % 10 === 0) {
          await setJob(admin, jobId, { stage: `ZIP 준비 ${downloaded}/${files.length}` });
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    await setJob(admin, jobId, { stage: "ZIP 압축 중" });
    const flat: Record<string, [Uint8Array, { level: number }]> = zipEntries;
    const zipBytes: Uint8Array = await new Promise((resolve, reject) => {
      zip(flat as any, { level: 0 }, (err, data) => err ? reject(err) : resolve(data));
    });

    const zipPath = `orders/${jobId}/bundle.zip`;
    await setJob(admin, jobId, { stage: `ZIP 업로드 중 (${(zipBytes.length / 1024 / 1024).toFixed(1)}MB)` });
    const { error: upErr } = await admin.storage.from(BUCKET)
      .upload(zipPath, new Blob([zipBytes], { type: "application/zip" }), {
        contentType: "application/zip",
        upsert: true,
      });
    if (upErr) throw new Error(`ZIP 업로드 실패: ${upErr.message}`);

    const { data: signed } = await admin.storage.from(BUCKET)
      .createSignedUrl(zipPath, 60 * 60 * 24 * 7);
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(zipPath);
    const zipUrl = signed?.signedUrl || pub.publicUrl;

    await setJob(admin, jobId, {
      zip_path: zipPath,
      zip_url: zipUrl,
      stage: `ZIP 업로드 완료 (${(zipBytes.length / 1024 / 1024).toFixed(1)}MB)`,
    });

    // --- WeChat send ---
    await setJob(admin, jobId, { stage: "위챗 전송 중" });
    const webhookUrl = (job.webhook_url || "").trim();
    const summary = `【열전사 디자인 발주】\n작업번호: ${folderName}\n디자인 수량: ${files.length}건\nZIP 파일명: bundle.zip\n크기: ${(zipBytes.length / 1024 / 1024).toFixed(2)}MB`;

    if (webhookUrl) {
      const key = extractWebhookKey(webhookUrl);
      try {
        if (zipBytes.length <= WECHAT_FILE_LIMIT && key) {
          const mediaId = await wechatUploadMedia(key, `${folderName}-bundle.zip`, zipBytes);
          await wechatSendJson(webhookUrl, { msgtype: "file", file: { media_id: mediaId } });
          await wechatSendJson(webhookUrl, { msgtype: "text", text: { content: summary } });
        } else {
          const reason = !key ? "webhook key 없음" : `${(zipBytes.length / 1024 / 1024).toFixed(1)}MB > 20MB`;
          await wechatSendJson(webhookUrl, {
            msgtype: "text",
            text: { content: `${summary}\n(${reason} → 다운로드 링크 전송)\n다운로드: ${zipUrl}` },
          });
        }
      } catch (e) {
        return await failJob(admin, jobId, `위챗 전송 실패: ${(e as Error).message}`);
      }
    }

    // --- History ---
    await setJob(admin, jobId, { stage: "발주 이력 기록 중" });
    const productCode = (job.payload as any)?.product_code || folderName;
    await admin.from("outsource_orders").insert({
      factory: "heat",
      order_no: folderName,
      product_code: productCode,
      quantity: files.length,
      ordered_at: new Date().toISOString().slice(0, 10),
      status: "ordered",
      note: `위챗 발송 · ${folderName} bundle.zip (${(zipBytes.length / 1024 / 1024).toFixed(2)}MB)`,
    });

    await setJob(admin, jobId, {
      status: "done",
      stage: "완료",
      zip_url: zipUrl,
      zip_path: zipPath,
      error_message: null,
    });
    return { status: "done", jobId, zip_url: zipUrl, size: zipBytes.length };
  } catch (e) {
    return await failJob(admin, jobId, (e as Error).message || String(e));
  }
}
