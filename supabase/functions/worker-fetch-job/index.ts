// Render Worker가 job 정보를 받아가는 엔드포인트.
// service_role 키를 워커에 노출하지 않기 위해 모든 DB/Storage 접근을 여기서 처리.
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

  const { data: job, error: jobErr } = await admin
    .from("order_jobs")
    .select("id, order_no, factory, webhook_url, callback_url, payload, status, progress_total")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobErr || !job) return json({ error: jobErr?.message || "job not found" }, 404);

  const { data: items, error: itemsErr } = await admin
    .from("order_job_items")
    .select("id, idx, source_url, filename, meta, status, attempts")
    .eq("job_id", body.jobId)
    .order("idx", { ascending: true });
  if (itemsErr) return json({ error: itemsErr.message }, 500);

  // Pre-sign upload URL for bundle.zip (worker PUTs directly to Storage).
  const bundlePath = `orders/${job.id}/bundle.zip`;
  const { data: uploadData, error: upErr } = await admin
    .storage.from(STORAGE_BUCKET).createSignedUploadUrl(bundlePath, { upsert: true });
  if (upErr || !uploadData) return json({ error: `signed upload url: ${upErr?.message}` }, 500);

  // Optional: signed download URL for work_order_pdf_path
  let pdfDownloadUrl: string | null = null;
  const pdfPath = (job.payload as Record<string, unknown> | null)?.["work_order_pdf_path"];
  if (typeof pdfPath === "string" && pdfPath) {
    const { data: pdfSig } = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(pdfPath, 60 * 60);
    pdfDownloadUrl = pdfSig?.signedUrl ?? null;
  }

  return json({
    job,
    items: items ?? [],
    bundle: {
      path: bundlePath,
      upload_url: uploadData.signedUrl,
      upload_token: uploadData.token,
    },
    work_order_pdf_url: pdfDownloadUrl,
  });
});
