import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BYTES = 20 * 1024 * 1024;

function sanitizeFilename(name: unknown) {
  const fallback = "download.png";
  if (typeof name !== "string") return fallback;
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").trim();
  return cleaned || fallback;
}

function isPrivateHostname(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return false;
}

function extensionFor(contentType: string) {
  const ct = contentType.toLowerCase();
  if (ct.includes("svg")) return "svg";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "bin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) throw new Error("Backend environment is not configured.");

    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body?.url === "string" ? body.url : "";
    let filename = sanitizeFilename(body?.filename);
    if (!rawUrl) {
      return new Response(JSON.stringify({ error: "url is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const target = new URL(rawUrl);
    if (!["http:", "https:"].includes(target.protocol) || isPrivateHostname(target.hostname)) {
      return new Response(JSON.stringify({ error: "Unsupported download URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent": "TWINMETA-Factory-Downloader/1.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!upstream.ok) throw new Error(`원본 파일 다운로드 실패: ${upstream.status}`);

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > MAX_BYTES) throw new Error("파일이 너무 큽니다. 20MB 이하 파일만 다운로드할 수 있습니다.");

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/") && !contentType.toLowerCase().includes("octet-stream")) {
      throw new Error("이미지 파일만 다운로드할 수 있습니다.");
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new Error("파일이 너무 큽니다. 20MB 이하 파일만 다운로드할 수 있습니다.");

    const ext = extensionFor(contentType);
    if (!new RegExp(`\\.${ext}$`, "i").test(filename) && ext !== "bin") {
      filename = filename.replace(/\.[^.]+$/, "") + `.${ext}`;
    }

    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/octet-stream",
        "X-Original-Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});