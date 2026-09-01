// Proxies requests to the tf2027 camera API, injecting the private X-API-Key
// header so it is never exposed to the browser. Path-based routing preserves
// relative URLs inside HLS playlists.
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": `${baseCors["Access-Control-Allow-Headers"] || "authorization, x-client-info, apikey, content-type"}, range`,

  "Access-Control-Expose-Headers": "content-type, content-length, content-disposition, content-range, accept-ranges, x-camera-stream-state",
};

const API_BASE = (Deno.env.get("TF2027_CAMERA_API_BASE") || "https://api.tf2027.xyz").replace(/\/+$/, "");
const API_KEY = Deno.env.get("TF2027_CAMERA_API_KEY") || "";

const printerErrorCode = (status: number, body: Record<string, unknown>) => {
  if (typeof body.error_code === "string" && body.error_code) return body.error_code;
  const detail = String(body.detail ?? body.error ?? "").toLowerCase();
  if (detail.includes("cancelled") || detail.includes("queue was cleared")) return "QUEUE_CANCELLED";
  if (detail.includes("timed out waiting for printer response")) return "PRINTER_RESPONSE_TIMEOUT";
  if (detail.includes("not ready") || detail.includes("not running")) return "PRINTER_NOT_READY";
  if (detail.includes("nak")) return "PRINTER_NAK";
  if (status === 503) return "PRINTER_SERIAL_DISCONNECTED";
  if (status === 504) return "PRINTER_RESPONSE_TIMEOUT";
  return "GATEWAY_ERROR";
};

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
  const isPlcStatus = /\/api\/v1\/plc\/[^/]+\/status$/i.test(url.pathname);
  const isPrinterApi = /\/api\/v1\/pf-printer(?:\/|$)/i.test(url.pathname);

  // Stage timing instrumentation: lets the client prove where a slow/failed
  // printer call actually spent its time (proxy vs upstream gateway/serial).
  const proxyReceivedAt = new Date().toISOString();
  const t0 = Date.now();
  let upstreamStartedMs = 0;

  try {
    const controller = new AbortController();
    // Printer requests are governed by the Gateway's serial timeout. Aborting
    // them here would discard its structured status/detail and make retry
    // safety impossible to determine.
    const timeout = isPrinterApi ? null : setTimeout(() => controller.abort(), 8000);
    const isBodyless = ["GET", "HEAD"].includes(req.method);
    const fwdHeaders: Record<string, string> = {
      "X-API-Key": API_KEY,
      "Accept": req.headers.get("accept") || "*/*",
    };
    // Forward Range so <video> can start playing (and seek) before the whole
    // MP4 has been transferred, instead of buffering it fully as a blob.
    const range = req.headers.get("range");
    if (range) fwdHeaders["Range"] = range;

    if (!isBodyless) {
      // FastAPI needs the content type to parse the JSON body; without it the
      // payload arrives as a raw string and fails model validation (422).
      fwdHeaders["Content-Type"] = req.headers.get("content-type") || "application/json";
    }
    let upstream: Response;
    try {
      upstreamStartedMs = Date.now();
      upstream = await fetch(target, {
        method: req.method,
        headers: fwdHeaders,
        body: isBodyless ? undefined : await req.arrayBuffer(),
        signal: controller.signal,
      });
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }


    // A recorder can briefly return 404 while its live recording pipeline is
    // starting or rotating segments. Also, the upstream host itself can be
    // temporarily unreachable (Cloudflare 502/503/504/520-530 tunnel errors)
    // when the on-site server is offline. Returning those statuses from an
    // Edge Function is promoted to a client runtime error. For the live
    // playlist path, convert both conditions to an empty successful response;
    // hls.js will retry.
    const isLivePlaylist = /\/live\/stream\.m3u8$/i.test(url.pathname);
    if (isLivePlaylist) {
      if (upstream.status === 404) {
        const detail = await upstream.clone().text().catch(() => "");
        if (/not currently recording/i.test(detail)) {
          return new Response(null, {
            status: 204,
            headers: {
              ...corsHeaders,
              "Cache-Control": "no-store",
              "X-Camera-Stream-State": "not-recording",
            },
          });
        }
      }
      if ([500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530].includes(upstream.status)) {
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders,
            "Cache-Control": "no-store",
            "X-Camera-Stream-State": "upstream-unreachable",
          },
        });
      }
    }

    // Printer failures must preserve the upstream HTTP status and diagnostic
    // payload. Older Gateway responses are augmented with a stable error_code;
    // the original detail/error fields are never removed.
    if (isPrinterApi && !upstream.ok) {
      const raw = await upstream.text();
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw);
        payload = parsed && typeof parsed === "object" ? parsed : { detail: raw };
      } catch {
        payload = { detail: raw || `HTTP ${upstream.status}` };
      }
      const errorCode = printerErrorCode(upstream.status, payload);
      const retryable = typeof payload.retryable === "boolean"
        ? payload.retryable
        : errorCode === "PRINTER_NOT_READY" || errorCode === "PRINTER_NAK";
      return new Response(JSON.stringify({ ...payload, error_code: errorCode, retryable }), {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // Non-printer gateway/tunnel failures remain expected device states.
    // expected device state, not an Edge Function failure. Returning a 5xx from
    // here is promoted by the host to a client runtime error / blank screen, so
    // answer 200 with an explicit offline flag and let the UI decide.
    if (upstream.status >= 500) {
      return new Response(
        JSON.stringify({ offline: true, upstream_status: upstream.status }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
        },
      );
    }



    const headers = new Headers(corsHeaders);
    const ct = upstream.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("content-length", cl);
    const cd = upstream.headers.get("content-disposition");
    if (cd) headers.set("content-disposition", cd);
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("content-range", cr);
    const ar = upstream.headers.get("accept-ranges");
    headers.set("accept-ranges", ar || "bytes");


    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    console.error("cctv-proxy upstream failure", target, String(err));
    const status = isPrinterApi ? 502 : 200;
    const payload = isPrinterApi
      ? { error_code: "GATEWAY_OFFLINE", detail: String(err), retryable: false }
      : { offline: true, upstream_status: 0, error: String(err) };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

});
