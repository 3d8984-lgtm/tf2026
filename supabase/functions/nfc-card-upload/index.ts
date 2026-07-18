import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BUCKET = "design-formats";
const ALLOWED_PREFIXES = ["nfc-card-test/", "nfc-card-test-back-grade/", "nfc-card-test-shape-grade/", "nfc-card-signature-edits/"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "로그인이 필요합니다" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "유효한 로그인 세션이 아닙니다" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("approved, role")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (profileError || !profile?.approved) {
      return new Response(JSON.stringify({ error: "승인된 사용자만 업로드할 수 있습니다" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const form = await req.formData();
    const file = form.get("file");
    const path = String(form.get("path") || "");
    const contentType = String(form.get("contentType") || "application/octet-stream");

    if (!(file instanceof File) || !path) {
      return new Response(JSON.stringify({ error: "file and path are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p)) || path.includes("..")) {
      return new Response(JSON.stringify({ error: "허용되지 않은 업로드 경로입니다", bucket: BUCKET, path }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType,
      cacheControl: "3600",
    });

    if (uploadError) {
      return new Response(JSON.stringify({ error: uploadError.message, bucket: BUCKET, path }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: pub } = adminClient.storage.from(BUCKET).getPublicUrl(path);
    return new Response(JSON.stringify({ bucket: BUCKET, path, publicUrl: pub.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});