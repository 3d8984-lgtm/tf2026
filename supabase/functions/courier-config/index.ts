import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: user.id });
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const code = (body.code as string | undefined)?.trim();

    if (action === "save_credentials") {
      if (!code) return json({ error: "code required" }, 400);
      const patch: Record<string, unknown> = { code };
      if (typeof body.api_key === "string" && body.api_key !== "") patch.api_key = body.api_key;
      if (typeof body.api_secret === "string" && body.api_secret !== "") patch.api_secret = body.api_secret;
      if (typeof body.account_no === "string") patch.account_no = body.account_no;
      if (body.extra && typeof body.extra === "object") patch.extra = body.extra;

      const { error } = await admin.from("courier_credentials").upsert(patch, { onConflict: "code" });
      if (error) return json({ error: error.message }, 400);

      const { data: cred } = await admin
        .from("courier_credentials")
        .select("api_key, api_secret")
        .eq("code", code)
        .maybeSingle();
      const has = Boolean(cred?.api_key || cred?.api_secret);
      await admin.from("courier_configs").update({ has_credentials: has }).eq("code", code);
      return json({ ok: true, has_credentials: has });
    }

    if (action === "clear_credentials") {
      if (!code) return json({ error: "code required" }, 400);
      await admin.from("courier_credentials").delete().eq("code", code);
      await admin.from("courier_configs").update({ has_credentials: false }).eq("code", code);
      return json({ ok: true });
    }

    if (action === "test_connection") {
      if (!code) return json({ error: "code required" }, 400);
      const { data: cfg } = await admin.from("courier_configs").select("*").eq("code", code).maybeSingle();
      const { data: cred } = await admin.from("courier_credentials").select("*").eq("code", code).maybeSingle();

      let ok = false;
      let message = "";
      if (!cfg) {
        message = "courier not found";
      } else if (!cred?.api_key && !cred?.api_secret) {
        message = "API credentials not configured";
      } else if (!cfg.api_url) {
        message = "API URL not configured";
      } else {
        try {
          const res = await fetch(cfg.api_url, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          });
          ok = res.status < 500;
          message = `HTTP ${res.status}`;
        } catch (e) {
          ok = false;
          message = e instanceof Error ? e.message : "network error";
        }
      }

      await admin
        .from("courier_configs")
        .update({ last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_message: message })
        .eq("code", code);
      return json({ ok, message });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
