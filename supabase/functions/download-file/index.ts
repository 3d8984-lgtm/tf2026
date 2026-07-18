import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BYTES = 20 * 1024 * 1024;
// v2: expired AWS presigned URL retry + storage fallback for 403 responses.

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

function isAwsPresignedUrl(url: URL) {
  return url.searchParams.has("X-Amz-Signature")
    && url.searchParams.has("X-Amz-Date")
    && url.searchParams.has("X-Amz-Expires");
}

function awsPresignedUrlExpired(url: URL) {
  const rawDate = url.searchParams.get("X-Amz-Date") || "";
  const expiresSeconds = Number(url.searchParams.get("X-Amz-Expires") || "0");
  const match = rawDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match || !Number.isFinite(expiresSeconds) || expiresSeconds <= 0) return false;
  const [, year, month, day, hour, minute, second] = match;
  const signedAt = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  return Date.now() >= signedAt + expiresSeconds * 1000;
}

function withoutAwsSignature(url: URL) {
  const unsigned = new URL(url.toString());
  for (const key of [...unsigned.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("x-amz-")) unsigned.searchParams.delete(key);
  }
  return unsigned;
}

function externalFetch(url: URL) {
  return fetch(url.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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

    // Try to parse Supabase Storage path from any URL containing /storage/v1/
    let bytes: Uint8Array | null = null;
    let contentType = "application/octet-stream";
    const tryStorageDownload = async (): Promise<boolean> => {
      if (!serviceKey) return false;
      if (!target.pathname.includes("/storage/v1/")) return false;
      const m = target.pathname.match(/\/storage\/v1\/(?:object|render\/image)\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/);
      if (!m) return false;
      const bucket = decodeURIComponent(m[1]);
      const path = decodeURIComponent(m[2]);
      const admin = createClient(supabaseUrl, serviceKey);
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) return false;
      bytes = new Uint8Array(await data.arrayBuffer());
      contentType = data.type || contentType;
      return true;
    };

    const ownHost = new URL(supabaseUrl).host;
    if (target.host === ownHost) {
      await tryStorageDownload();
    }

    if (!bytes) {
      let upstream = await externalFetch(target);
      const expiredAwsUrl = isAwsPresignedUrl(target) && awsPresignedUrlExpired(target);

      // Some S3 objects are public, but an expired/invalid X-Amz signature makes
      // S3 reject an otherwise readable object. On any 403 with AWS signing
      // params, retry once with the signing parameters stripped.
      if (upstream.status === 403 && isAwsPresignedUrl(target)) {
        upstream.body?.cancel().catch(() => undefined);
        upstream = await externalFetch(withoutAwsSignature(target));
      }

      if (!upstream.ok) {
        // Fallback: attempt service-role storage download regardless of host
        const ok = await tryStorageDownload();
        if (!ok) {
          if (expiredAwsUrl) {
            throw new Error("원본 이미지 링크가 만료되었습니다(비공개 S3). 주문 데이터를 다시 가져와 새 링크를 받아주세요.");
          }
          throw new Error(`외부 원본 서버가 다운로드를 거부했습니다: ${upstream.status}`);
        }
      } else {
        const contentLength = Number(upstream.headers.get("content-length") || 0);
        if (contentLength > MAX_BYTES) throw new Error("파일이 너무 큽니다. 20MB 이하 파일만 다운로드할 수 있습니다.");
        contentType = upstream.headers.get("content-type") || contentType;
        bytes = new Uint8Array(await upstream.arrayBuffer());
      }
    }

    if (!contentType.toLowerCase().startsWith("image/") && !contentType.toLowerCase().includes("octet-stream")) {
      throw new Error("이미지 파일만 다운로드할 수 있습니다.");
    }
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