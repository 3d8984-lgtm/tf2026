// 브라우저에서 ZIP을 Storage에 PUT 완료한 뒤 호출.
// bundle_zip_path/bundle_size를 기록하고 worker의 wechat-resend를 트리거해서
// 위챗 전송만 시키는 라이트 엔드포인트.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ORDERS_API_KEY = Deno.env.get("ORDERS_API_KEY") || "";
const WORKER_URL = Deno.env.get("WORKER_URL") || "";
const WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "";
const STORAGE_BUCKET = Deno.env.get("STORAGE_BUCKET") || "hologram-pdf";

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BodySchema = z.object({
  jobId: z.string().uuid(),
  bundle_size: z.number().int().min(1).optional(),
});

async function triggerWechat(jobId: string) {
  if (!WORKER_URL || !WORKER_SECRET) {
    throw new Error("WORKER_URL / WORKER_SECRET 미설정");
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);
  try {
    const r = await fetch(`${WORKER_URL.replace(/\/$/, "")}/internal/wechat-resend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({ jobId }),
      signal: ac.signal,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`worker ${r.status}: ${txt.slice(0, 300)}`);
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Auth: API key or valid Supabase JWT
  const authHeader = req.headers.get("Authorization") || "";
  const apiKey = req.headers.get("x-api-key") || "";
  let authorized = false;
  if (ORDERS_API_KEY && (apiKey === ORDERS_API_KEY || authHeader === `Bearer ${ORDERS_API_KEY}`)) {
    authorized = true;
  } else if (authHeader.startsWith("Bearer ")) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await userClient.auth.getUser();
    if (!error && data.user) authorized = true;
  }
  if (!authorized) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }
  const { jobId, bundle_size } = parsed.data;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Confirm job exists and resolve bundle path.
  const { data: job, error: jobErr } = await admin
    .from("order_jobs")
    .select("id, status, bundle_zip_path")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr || !job) return json({ error: jobErr?.message || "job not found" }, 404);

  const bundlePath = job.bundle_zip_path || `orders/${jobId}/bundle.zip`;

  // Verify the ZIP actually exists in Storage (browser upload completed).
  const objectInfo = await admin.storage.from(STORAGE_BUCKET).list(`orders/${jobId}`, { limit: 10 });
  const found = objectInfo.data?.find((o) => o.name === "bundle.zip");
  if (!found) {
    await admin.from("order_jobs").update({
      status: "failed",
      error_message: "ZIP 업로드 확인 실패 (bundle.zip 없음)",
    }).eq("id", jobId);
    return json({ error: "bundle.zip not found in storage" }, 400);
  }

  // Generate long-lived signed view URL.
  const { data: sig } = await admin.storage.from(STORAGE_BUCKET)
    .createSignedUrl(bundlePath, 60 * 60 * 24 * 7);

  await admin.from("order_jobs").update({
    bundle_zip_path: bundlePath,
    bundle_zip_url: sig?.signedUrl ?? null,
    bundle_size: bundle_size ?? (found as any).metadata?.size ?? null,
    status: "wechat",
    stage: "위챗 전송 중",
    error_message: null,
  }).eq("id", jobId);

  try {
    // @ts-ignore Deno EdgeRuntime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(triggerWechat(jobId));
    else await triggerWechat(jobId);
  } catch (e) {
    await admin.from("order_jobs").update({
      status: "failed",
      error_message: `worker trigger: ${(e as Error).message}`,
    }).eq("id", jobId);
    return json({ error: (e as Error).message }, 500);
  }

  return json({ jobId, status: "wechat" }, 202);
});
