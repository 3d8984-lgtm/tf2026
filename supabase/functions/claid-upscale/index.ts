// Claid.ai upscale edge function
// Docs: https://docs.claid.ai/image-editing-api/upscaling
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const CLAID_API = "https://api.claid.ai/v1-beta1/image/edit";

interface ReqBody {
  imageBase64: string; // data URL (data:image/png;base64,...) or pure base64
  upscale?: "smart_enhance" | "smart_resize" | "faces"; // restoration type
  scale?: 2 | 4; // target scale factor
  format?: "png" | "jpeg" | "webp";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("CLAID_API_KEY");
    if (!apiKey) throw new Error("CLAID_API_KEY is not configured");

    const body = (await req.json()) as ReqBody;
    if (!body?.imageBase64) throw new Error("imageBase64 is required");

    const dataUrl = body.imageBase64.startsWith("data:")
      ? body.imageBase64
      : `data:image/png;base64,${body.imageBase64}`;

    const scale = body.scale ?? 2;
    const upscaleType = body.upscale ?? "smart_enhance";
    const format = body.format ?? "png";

    const claidPayload = {
      input: dataUrl,
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

    // Fetch the result and return as base64 to the client
    const imgRes = await fetch(tmpUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch result image: ${imgRes.status}`);
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    const mime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";

    return new Response(
      JSON.stringify({
        success: true,
        dataUrl: `data:${mime};base64,${b64}`,
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
