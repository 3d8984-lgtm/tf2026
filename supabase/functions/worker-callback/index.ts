// Railway Worker → Supabase 콜백.
// 진행률, 상태, 항목 업데이트, 번들 경로를 받아 DB에 반영 → Realtime이 UI로 푸시.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "";
const STORAGE_BUCKET = Deno.env.get("STORAGE_BUCKET") || "hologram-pdf";

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface ItemUpdate {
  id?: string;
  idx?: number;
  status?: "pending" | "processing" | "uploaded" | "failed" | "skipped";
  attempts?: number;
  error_message?: string | null;
  output_path?: string | null;
}

interface CallbackBody {
  jobId: string;
  status?: "queued" | "processing" | "uploading" | "wechat" | "done" | "failed";
  stage?: string;
  progress_current?: number;
  progress_total?: number;
  bundle_zip_path?: string | null;
  bundle_zip_url?: string | null;
  bundle_size?: number | null;
  error_message?: string | null;
  item_updates?: ItemUpdate[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const provided = req.headers.get("x-worker-secret") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!WORKER_SECRET || provided !== WORKER_SECRET) return json({ error: "unauthorized" }, 401);

  let body: CallbackBody;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (!body.jobId) return json({ error: "jobId required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const patch: Record<string, unknown> = {};
  for (const k of ["status", "stage", "progress_current", "progress_total", "bundle_zip_path", "bundle_zip_url", "bundle_size", "error_message"] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  // Auto-generate signed URL when worker provides bundle_zip_path without an explicit URL.
  if (typeof patch.bundle_zip_path === "string" && !patch.bundle_zip_url) {
    const { data: sig } = await admin.storage.from(STORAGE_BUCKET)
      .createSignedUrl(patch.bundle_zip_path as string, 60 * 60 * 24 * 7);
    if (sig?.signedUrl) patch.bundle_zip_url = sig.signedUrl;
  }
  if (Object.keys(patch).length) {
    const { error } = await admin.from("order_jobs").update(patch).eq("id", body.jobId);
    if (error) return json({ error: error.message }, 500);
  }

  if (body.item_updates?.length) {
    for (const u of body.item_updates) {
      const upd: Record<string, unknown> = {};
      for (const k of ["status", "attempts", "error_message", "output_path"] as const) {
        if (u[k] !== undefined) upd[k] = u[k];
      }
      if (!Object.keys(upd).length) continue;
      const q = admin.from("order_job_items").update(upd).eq("job_id", body.jobId);
      if (u.id) await q.eq("id", u.id);
      else if (u.idx !== undefined) await q.eq("idx", u.idx);
    }
  }

  return json({ ok: true });
});
