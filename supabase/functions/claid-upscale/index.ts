// Claid.ai upscale edge function
// Docs: https://docs.claid.ai/image-editing-api/upscaling
// Claid requires `input` to be a publicly accessible URL — data URIs are rejected.
// We upload the incoming base64 to a public Supabase Storage bucket, call Claid,
// then fetch the result and return it as base64 to the client.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const CLAID_API = "https://api.claid.ai/v1-beta1/image/edit";
const BUCKET = "design-images"; // existing public bucket

interface ReqBody {
  imageBase64: string;
  upscale?: "smart_enhance" | "smart_resize" | "faces";
  scale?: 2 | 4;
  format?: "png" | "jpeg" | "webp";
}

function parseDataUrl(input: string): { mime: string; ext: string; b64: string } {
  let mime = "image/png";
  let b64 = input.trim();
  if (b64.startsWith("data:")) {
    const m = b64.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) throw new Error("Malformed data URL");
    mime = m[1];
    b64 = m[2];
  }
  b64 = b64.replace(/\s/g, "");
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  return { mime, ext, b64 };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("CLAID_API_KEY");
    if (!apiKey) throw new Error("CLAID_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = (await req.json()) as ReqBody;
    if (!body?.imageBase64) throw new Error("imageBase64 is required");

    const { mime, ext, b64 } = parseDataUrl(body.imageBase64);
    const bytes = b64ToBytes(b64);

    // Upload to public bucket under tmp/
    const objectPath = `claid-tmp/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(objectPath, bytes, { contentType: mime, upsert: false });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath);
    const inputUrl = pub.publicUrl;

    const scale = body.scale ?? 2;
    const upscaleType = body.upscale ?? "smart_enhance";
    const format = body.format ?? "png";

    const claidPayload = {
      input: inputUrl,
      operations: {
        restorations: { upscale: upscaleType },
        resizing: { width: `${scale * 100}%`, fit: "bounds" },
      },
      output: { format: { type: format, compression: "optimal" } },
    };

    const res = await fetch(CLAID_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(claidPayload),
    });

    const text = await res.text();

    // Clean up source upload (best-effort)
    admin.storage.from(BUCKET).remove([objectPath]).catch(() => {});

    if (!res.ok) {
      console.error("Claid error:", res.status, text);
      return new Response(
        JSON.stringify({ error: `Claid API ${res.status}: ${text}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = JSON.parse(text);
    const tmpUrl: string | undefined = json?.data?.output?.tmp_url;
    if (!tmpUrl) throw new Error("Claid response missing tmp_url");

    const imgRes = await fetch(tmpUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch result image: ${imgRes.status}`);
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const outB64 = btoa(bin);
    const outMime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";

    return new Response(
      JSON.stringify({
        success: true,
        dataUrl: `data:${outMime};base64,${outB64}`,
        meta: json?.data?.output ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("claid-upscale error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
