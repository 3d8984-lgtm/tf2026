import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BUCKET = "design-formats";
const FOLDER = "heat-transfer";

type JsonBody = Record<string, unknown>;

function json(body: JsonBody, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeFileName(name: string) {
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "format.pdf";
}

function parseOriginalName(id: string) {
  const parts = id.split("__");
  if (parts.length >= 4 && parts[0] === "fmt") return parts.slice(3).join("__");
  return id.split("/").pop() || "format.pdf";
}

function storedName(sizeLabel: string, originalName: string) {
  return `fmt__${encodeURIComponent(sizeLabel)}__${Date.now()}__${safeFileName(originalName)}`;
}

function cleanId(id: string) {
  const value = id.trim();
  if (!value || value.includes("..") || value.includes("/")) return null;
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ ok: false, error: "Storage function is not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "로그인이 필요합니다" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json({ ok: false, error: userError?.message || "유효한 로그인 세션이 아닙니다" }, 401);

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("approved, role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) return json({ ok: false, error: profileError.message }, 500);
    if (!profile?.approved) return json({ ok: false, error: "승인된 사용자만 디자인 포맷을 변경할 수 있습니다" }, 403);

    const form = await req.formData();
    const action = String(form.get("action") || "");

    if (action === "upload") {
      const sizeLabel = String(form.get("sizeLabel") || "").trim();
      const file = form.get("file");
      if (!sizeLabel) return json({ ok: false, error: "사이즈를 입력하세요" }, 400);
      if (!(file instanceof File)) return json({ ok: false, error: "PDF 파일이 필요합니다" }, 400);
      if (file.type && file.type !== "application/pdf") return json({ ok: false, error: "PDF 파일만 업로드할 수 있습니다" }, 400);

      const id = storedName(sizeLabel, file.name);
      const path = `${FOLDER}/${id}`;
      const { error } = await adminClient.storage.from(BUCKET).upload(path, file, {
        upsert: true,
        contentType: "application/pdf",
        cacheControl: "0",
      });
      if (error) return json({ ok: false, error: error.message, code: error.name, statusCode: error.statusCode }, 500);
      return json({ ok: true, action, id, path, name: file.name, sizeLabel });
    }

    if (action === "delete") {
      const id = cleanId(String(form.get("id") || ""));
      if (!id) return json({ ok: false, error: "유효하지 않은 파일입니다" }, 400);
      const path = `${FOLDER}/${id}`;
      const { data, error } = await adminClient.storage.from(BUCKET).remove([path]);
      if (error) return json({ ok: false, error: error.message, code: error.name, statusCode: error.statusCode }, 500);
      return json({ ok: true, action, removed: data || [], id });
    }

    if (action === "rename") {
      const id = cleanId(String(form.get("id") || ""));
      const sizeLabel = String(form.get("sizeLabel") || "").trim();
      if (!id) return json({ ok: false, error: "유효하지 않은 파일입니다" }, 400);
      if (!sizeLabel) return json({ ok: false, error: "사이즈를 입력하세요" }, 400);

      const newId = storedName(sizeLabel, parseOriginalName(id));
      const fromPath = `${FOLDER}/${id}`;
      const toPath = `${FOLDER}/${newId}`;
      const { error: moveError } = await adminClient.storage.from(BUCKET).move(fromPath, toPath);
      if (moveError) {
        const { error: copyError } = await adminClient.storage.from(BUCKET).copy(fromPath, toPath);
        if (copyError) return json({ ok: false, error: copyError.message, code: copyError.name, statusCode: copyError.statusCode }, 500);
        await adminClient.storage.from(BUCKET).remove([fromPath]);
      }
      return json({ ok: true, action, id, newId, fromPath, toPath, sizeLabel });
    }

    return json({ ok: false, error: "유효하지 않은 작업입니다" }, 400);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});