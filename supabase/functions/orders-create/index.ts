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
  items: z.array(ItemSchema).min(1).max(5000),
});

async function enqueueWorker(admin: ReturnType<typeof createClient>, jobId: string) {
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
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;

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

  // --- Idempotency: insert order_jobs, ignore conflict on order_no ---
  const { data: existing } = await admin
    .from("order_jobs")
    .select("id, status, progress_current, progress_total")
    .eq("order_no", body.orderNo)
    .maybeSingle();
  if (existing) {
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
      progress_total: body.items.length,
      status: "queued",
      stage: "큐 등록",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (insErr || !inserted) return json({ error: insErr?.message || "insert failed" }, 500);
  const jobId = inserted.id as string;

  // Batch insert items (chunks of 500)
  const rows = body.items.map((it) => ({
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
