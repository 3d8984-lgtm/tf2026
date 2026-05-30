import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BUCKET = "silicon-templates";
const GRADES = new Set(["COMMON", "RARE", "EPIC", "LEGEND"]);

type JsonBody = Record<string, unknown>;

function json(body: JsonBody, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeFileName(name: string) {
  return name.replace(/[^\w.-]+/g, "_") || "template.pdf";
}

async function logFailure(adminClient: ReturnType<typeof createClient>, payload: JsonBody) {
  try {
    await adminClient.from("webhook_logs").insert({
      source: "silicon_factory",
      event_type: `storage_${payload.action || "unknown"}_failed`,
      status: "error",
      error_message: String(payload.message || "Silicon template storage failed"),
      payload,
    });
  } catch (error) {
    console.error("silicon-template-storage log failure", error);
  }
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

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ ok: false, error: "로그인이 필요합니다" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) {
      return json({ ok: false, error: userError?.message || "유효한 로그인 세션이 아닙니다" }, 401);
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("approved, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      await logFailure(adminClient, {
        action: "auth_check",
        user_id: user.id,
        message: profileError.message,
        code: profileError.code,
      });
      return json({ ok: false, error: profileError.message, code: profileError.code }, 500);
    }

    if (!profile?.approved || profile.role !== "admin") {
      return json({ ok: false, error: "관리자만 PDF 설정을 변경할 수 있습니다" }, 403);
    }

    const form = await req.formData();
    const action = String(form.get("action") || "");
    const grade = String(form.get("grade") || "").toUpperCase();

    if (!GRADES.has(grade)) {
      return json({ ok: false, error: "유효하지 않은 등급입니다", grade }, 400);
    }
    if (action !== "upload" && action !== "delete") {
      return json({ ok: false, error: "유효하지 않은 작업입니다", action }, 400);
    }

    const folder = user.id;
    const prefix = `${folder}/`;
    const { data: existing, error: listError } = await adminClient.storage.from(BUCKET).list(folder);
    if (listError) {
      await logFailure(adminClient, {
        action,
        grade,
        path: prefix,
        http_status: listError.statusCode || null,
        code: listError.name || "StorageApiError",
        message: listError.message,
      });
      return json({ ok: false, error: listError.message, code: listError.name, statusCode: listError.statusCode }, 500);
    }

    const removePaths = (existing || [])
      .filter((item) => item.name === `${grade}.pdf` || item.name.startsWith(`${grade}__`))
      .map((item) => `${prefix}${item.name}`);

    if (removePaths.length > 0) {
      const { error: removeError } = await adminClient.storage.from(BUCKET).remove(removePaths);
      if (removeError) {
        await logFailure(adminClient, {
          action: "delete",
          grade,
          path: removePaths.join(","),
          http_status: removeError.statusCode || null,
          code: removeError.name || "StorageApiError",
          message: removeError.message,
        });
        return json({ ok: false, error: removeError.message, code: removeError.name, statusCode: removeError.statusCode }, 500);
      }
    }

    if (action === "delete") {
      return json({ ok: true, action, grade, removed: removePaths });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "PDF 파일이 필요합니다" }, 400);
    }
    if (file.type && file.type !== "application/pdf") {
      return json({ ok: false, error: "PDF 파일만 업로드할 수 있습니다", contentType: file.type }, 400);
    }

    const fileName = safeFileName(file.name);
    const path = `${prefix}${grade}__${fileName}`;
    const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: "application/pdf",
      cacheControl: "3600",
    });

    if (uploadError) {
      await logFailure(adminClient, {
        action: "upload",
        grade,
        path,
        file_name: file.name,
        file_size: file.size,
        http_status: uploadError.statusCode || null,
        code: uploadError.name || "StorageApiError",
        message: uploadError.message,
      });
      return json({ ok: false, error: uploadError.message, code: uploadError.name, statusCode: uploadError.statusCode }, 500);
    }

    return json({ ok: true, action, grade, path, name: file.name, size: file.size, removed: removePaths });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logFailure(adminClient, { action: "unexpected", message });
    return json({ ok: false, error: message }, 500);
  }
});
