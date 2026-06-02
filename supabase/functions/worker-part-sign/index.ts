// Mints signed upload URLs for per-PNG parts AND lists parts already uploaded.
// Called by the Render worker — protected by x-worker-secret.
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

  let body: { jobId?: string; name?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const jobId = body.jobId;
  const action = body.action || "sign";
  if (!jobId) return json({ error: "jobId required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const prefix = `orders/${jobId}/parts`;

  if (action === "list") {
    const { data, error } = await admin.storage.from(STORAGE_BUCKET).list(prefix, { limit: 2000 });
    if (error) return json({ error: error.message }, 500);
    const files = (data || []).filter((f) => f.name && !f.name.startsWith("."));
    const signed = await Promise.all(files.map(async (f) => {
      const { data: s } = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(`${prefix}/${f.name}`, 60 * 60 * 6);
      return { name: f.name, size: (f.metadata as any)?.size ?? 0, url: s?.signedUrl || "" };
    }));
    return json({ files: signed });
  }

  // action === "sign"
  if (!body.name) return json({ error: "name required" }, 400);
  const path = `${prefix}/${body.name}`;
  const { data, error } = await admin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return json({ error: error?.message || "sign failed" }, 500);
  return json({ path, upload_url: data.signedUrl, upload_token: data.token });
});
