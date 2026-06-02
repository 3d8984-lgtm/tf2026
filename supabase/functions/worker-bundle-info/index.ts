// wechat-resend 등 워커가 기존 bundle.zip을 다시 다운로드/조회할 때 사용.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "";
const STORAGE_BUCKET = Deno.env.get("STORAGE_BUCKET") || "hologram-pdf";

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const provided = req.headers.get("x-worker-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!WORKER_SECRET || provided !== WORKER_SECRET) return json({ error: "unauthorized" }, 401);

  let body: { jobId?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (!body.jobId) return json({ error: "jobId required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: job, error } = await admin
    .from("order_jobs")
    .select("id, order_no, webhook_url, bundle_zip_path, progress_total")
    .eq("id", body.jobId)
    .maybeSingle();
  if (error || !job) return json({ error: error?.message || "job not found" }, 404);
  if (!job.bundle_zip_path) return json({ error: "bundle not generated" }, 400);

  const { data: viewSig } = await admin.storage.from(STORAGE_BUCKET)
    .createSignedUrl(job.bundle_zip_path, 60 * 60 * 24 * 7);
  const { data: dlSig } = await admin.storage.from(STORAGE_BUCKET)
    .createSignedUrl(job.bundle_zip_path, 60 * 60);

  return json({
    job,
    bundle_zip_view_url: viewSig?.signedUrl ?? null,
    bundle_zip_download_url: dlSig?.signedUrl ?? null,
  });
});
