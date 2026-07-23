// Proxies requests to the tf2027 camera API, injecting the private X-API-Key
// header so it is never exposed to the browser. Path-based routing preserves
// relative URLs inside HLS playlists.
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-type, content-length, content-disposition",
};

const API_BASE = (Deno.env.get("TF2027_CAMERA_API_BASE") || "https://api.tf2027.xyz").replace(/\/+$/, "");
const API_KEY = Deno.env.get("TF2027_CAMERA_API_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!API_KEY) {
    return new Response(JSON.stringify({ error: "TF2027_CAMERA_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  // Strip the function name prefix so path routing behaves like a transparent proxy.
  // Supabase invokes as /functions/v1/cctv-proxy[/rest...]?query
  const marker = "/cctv-proxy";
  const idx = url.pathname.indexOf(marker);
  const rest = idx >= 0 ? url.pathname.slice(idx + marker.length) : url.pathname;
  const target = `${API_BASE}${rest || "/"}${url.search || ""}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        "X-API-Key": API_KEY,
        "Accept": req.headers.get("accept") || "*/*",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
    });

    const headers = new Headers(corsHeaders);
    const ct = upstream.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("content-length", cl);
    const cd = upstream.headers.get("content-disposition");
    if (cd) headers.set("content-disposition", cd);

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
