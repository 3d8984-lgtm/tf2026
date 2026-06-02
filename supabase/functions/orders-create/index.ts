// POST /v1/orders → 큐잉 전용 Edge Function.
// Sharp/ZIP/위챗은 절대 호출하지 않음. Railway Worker로 jobId만 넘김.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ORDERS_API_KEY = Deno.env.get("ORDERS_API_KEY") || "";
const WORKER_URL = Deno.env.get("WORKER_URL") || "";
const WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ItemSchema = z.object({
  idx: z.number().int().min(0),
  source_url: z.string().min(1),
  filename: z.string().default(""),
  meta: z.record(z.unknown()).default({}),
});

const BodySchema = z.object({
  orderNo: z.string().min(1).max(120),
  factory: z.string().min(1).max(40),
  webhookUrl: z.string().url().or(z.literal("")).default(""),
  callbackUrl: z.string().url().optional(),
  payload: z.record(z.unknown()).default({}),
  // Legacy mode (worker builds ZIP from per-item URLs)
  items: z.array(ItemSchema).max(5000).optional(),
  // Stream mode (browser uploads finished ZIP directly to Storage)
  stream: z.boolean().optional(),
  itemCount: z.number().int().min(1).max(5000).optional(),
});

const STORAGE_BUCKET = Deno.env.get("STORAGE_BUCKET") || "hologram-pdf";

async function enqueueWorker(admin: any, jobId: string) {
  if (!WORKER_URL || !WORKER_SECRET) {
    await admin.from("order_jobs").update({
      status: "failed",
      error_message: "WORKER_URL / WORKER_SECRET 미설정 — 워커가 아직 배포되지 않았습니다",
    }).eq("id", jobId);
    return;
  }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    const r = await fetch(`${WORKER_URL.replace(/\/$/, "")}/internal/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({ jobId }),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      const txt = await r.text();
      await admin.from("order_jobs").update({
        status: "failed",
        error_message: `worker enqueue ${r.status}: ${txt.slice(0, 300)}`,
      }).eq("id", jobId);
    }
  } catch (e) {
    await admin.from("order_jobs").update({
      status: "failed",
      error_message: `worker unreachable: ${(e as Error).message}`,
    }).eq("id", jobId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // --- Auth: either API key OR a valid Supabase JWT ---
  const authHeader = req.headers.get("Authorization") || "";
  const apiKey = req.headers.get("x-api-key") || "";
  let authorized = false;
  let createdBy: string | null = null;
  if (ORDERS_API_KEY && (apiKey === ORDERS_API_KEY || authHeader === `Bearer ${ORDERS_API_KEY}`)) {
    authorized = true;
  } else if (authHeader.startsWith("Bearer ")) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await userClient.auth.getUser();
    if (!error && data.user) { authorized = true; createdBy = data.user.id; }
  }
  if (!authorized) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).__resume === "string") {
    const jobId = (raw as Record<string, string>).__resume;
    await admin.from("order_job_items").update({ status: "pending", attempts: 0, error_message: null }).eq("job_id", jobId);
    const { error } = await admin.from("order_jobs").update({
      status: "queued",
      stage: "큐 재등록",
      progress_current: 0,
      error_message: null,
    }).eq("id", jobId);
    if (error) return json({ error: error.message }, 500);
    // @ts-ignore Deno EdgeRuntime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(enqueueWorker(admin, jobId));
    else enqueueWorker(admin, jobId);
    return json({ jobId, status: "queued", resumed: true }, 202);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;
  const isStream = body.stream === true;
  const itemsArr = body.items ?? [];
  if (!isStream && itemsArr.length === 0) {
    return json({ error: "items required (or set stream:true with itemCount)" }, 400);
  }
  if (isStream && (!body.itemCount || body.itemCount < 1)) {
    return json({ error: "itemCount required for stream mode" }, 400);
  }
  const totalCount = isStream ? (body.itemCount as number) : itemsArr.length;

  // Stream mode now uploads to the Render worker directly (not Storage), which then
  // pipes the ZIP to Storage with a proper Content-Length. This avoids the chunked-PUT
  // hang we saw against Supabase Storage signed upload URLs.
  const mintWorkerUpload = async (jobId: string) => {
    if (!WORKER_URL) throw new Error("WORKER_URL 미설정");
    // 256-bit random token
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    const token = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await admin.from("order_jobs")
      .update({ upload_token: token })
      .eq("id", jobId);
    if (error) throw new Error(`upload_token persist: ${error.message}`);
    const base = `${WORKER_URL.replace(/\/$/, "")}/orders/${jobId}`;
    return {
      path: `orders/${jobId}/bundle.zip`,
      // Legacy single-stream URL (kept for backwards compat).
      upload_url: `${base}/upload-stream?token=${token}`,
      // New per-PNG pipeline: client PUTs each PNG to parts_url, then POSTs finalize_url.
      parts_url: `${base}/parts?token=${token}`,
      finalize_url: `${base}/finalize?token=${token}`,
      abort_url: `${base}/parts?token=${token}`,
      upload_token: token,
    };
  };

  // --- Idempotency: insert order_jobs, ignore conflict on order_no ---
  const { data: existing } = await admin
    .from("order_jobs")
    .select("id, status, progress_current, progress_total, updated_at")
    .eq("order_no", body.orderNo)
    .maybeSingle();
  if (existing) {
    const updatedAt = existing.updated_at ? new Date(existing.updated_at as string).getTime() : 0;
    const staleMs = Date.now() - updatedAt;
    const shouldRequeue = existing.status === "failed" || staleMs > 2 * 60 * 1000;
    if (shouldRequeue && existing.status !== "done") {
      await admin.from("order_job_items").update({ status: "pending", attempts: 0, error_message: null }).eq("job_id", existing.id);
      await admin.from("order_jobs").update({
        status: isStream ? "uploading" : "queued",
        stage: isStream ? "ZIP 업로드 대기" : "큐 재등록",
        progress_current: 0,
        progress_total: totalCount,
        bundle_zip_path: null,
        bundle_zip_url: null,
        bundle_size: null,
        error_message: null,
        payload: body.payload,
        webhook_url: body.webhookUrl,
      }).eq("id", existing.id);
      if (isStream) {
        try {
          const bundle = await mintWorkerUpload(existing.id as string);
          return json({ jobId: existing.id, status: "uploading", idempotent: true, requeued: true, bundle }, 202);
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      }
      // @ts-ignore Deno EdgeRuntime
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(enqueueWorker(admin, existing.id as string));
      else enqueueWorker(admin, existing.id as string);
      return json({ jobId: existing.id, status: "queued", idempotent: true, requeued: true }, 202);
    }
    return json({ jobId: existing.id, status: existing.status, idempotent: true }, 202);
  }

  const { data: inserted, error: insErr } = await admin
    .from("order_jobs")
    .insert({
      order_no: body.orderNo,
      factory: body.factory,
      webhook_url: body.webhookUrl,
      callback_url: body.callbackUrl,
      payload: body.payload,
      progress_total: totalCount,
      status: isStream ? "uploading" : "queued",
      stage: isStream ? "ZIP 업로드 대기" : "큐 등록",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (insErr || !inserted) return json({ error: insErr?.message || "insert failed" }, 500);
  const jobId = inserted.id as string;

  if (isStream) {
    try {
      const bundle = await mintWorkerUpload(jobId);
      return json({ jobId, status: "uploading", bundle }, 202);
    } catch (e) {
      await admin.from("order_jobs").update({
        status: "failed",
        error_message: (e as Error).message,
      }).eq("id", jobId);
      return json({ error: (e as Error).message }, 500);
    }
  }

  // Legacy items mode: batch insert items, enqueue worker for processing.
  const rows = itemsArr.map((it) => ({
    job_id: jobId,
    idx: it.idx,
    source_url: it.source_url,
    filename: it.filename,
    meta: it.meta,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await admin.from("order_job_items").insert(slice);
    if (error) {
      await admin.from("order_jobs").update({
        status: "failed",
        error_message: `items insert failed: ${error.message}`,
      }).eq("id", jobId);
      return json({ error: error.message }, 500);
    }
  }

  // --- Fire-and-forget enqueue to Railway worker ---
  // @ts-ignore Deno EdgeRuntime
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(enqueueWorker(admin, jobId));
  else enqueueWorker(admin, jobId);

  return json({ jobId, status: "queued" }, 202);
});
