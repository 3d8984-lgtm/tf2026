import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();

    // Support two modes:
    // 1. Direct call from frontend with shipment_id (manual sync)
    // 2. Trigger call with full payload (auto sync from DB trigger)

    let callbackUrl: string;
    let authHeader: string;
    let authValue: string;
    let payload: Record<string, unknown>;

    if (body.callback_url) {
      // Called from DB trigger - payload includes callback config
      callbackUrl = body.callback_url;
      authHeader = body.auth_header;
      authValue = body.auth_value;
      payload = {
        event: body.event,
        order_id: body.order_id,
        external_order_id: body.external_order_id,
        tracking_number: body.tracking_number,
        carrier: body.carrier,
        status: body.status,
        timestamp: new Date().toISOString(),
      };
    } else if (body.shipment_id) {
      // Called from frontend - need to look up config and shipment
      const { data: settings } = await supabase
        .from("callback_settings")
        .select("*")
        .limit(1)
        .single();

      if (!settings?.enabled || !settings?.callback_url) {
        return new Response(
          JSON.stringify({ error: "Callback not configured or disabled" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      callbackUrl = settings.callback_url;
      authHeader = settings.auth_header;
      authValue = settings.auth_value;

      // Get shipment + order info
      const { data: shipment } = await supabase
        .from("shipments")
        .select("*, orders(external_order_id, recipient_name, product_code, quantity)")
        .eq("id", body.shipment_id)
        .single();

      if (!shipment) {
        return new Response(
          JSON.stringify({ error: "Shipment not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const order = (shipment as any).orders;
      payload = {
        event: body.event || "tracking_update",
        order_id: shipment.order_id,
        external_order_id: order?.external_order_id,
        tracking_number: shipment.tracking_number,
        carrier: shipment.carrier,
        status: shipment.status,
        shipped_at: shipment.shipped_at,
        delivered_at: shipment.delivered_at,
        timestamp: new Date().toISOString(),
      };
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send to Site A
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authHeader && authValue) {
      headers[authHeader] = authValue;
    }

    let callbackStatus = "success";
    let errorMessage: string | null = null;

    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        callbackStatus = "failed";
        errorMessage = `HTTP ${response.status}: ${await response.text()}`;
      }
    } catch (fetchErr) {
      callbackStatus = "failed";
      errorMessage = fetchErr instanceof Error ? fetchErr.message : "Network error";
    }

    // Log to webhook_logs
    await supabase.from("webhook_logs").insert({
      event_type: payload.event as string,
      source: "site_a_callback",
      status: callbackStatus,
      error_message: errorMessage,
      payload: payload as any,
    });

    // Update shipment sync status
    if (body.shipment_id || body.shipment_id === undefined) {
      const shipmentId = body.shipment_id || body.shipment_id;
      if (shipmentId) {
        await supabase
          .from("shipments")
          .update({
            synced_to_source: callbackStatus === "success",
            synced_at: new Date().toISOString(),
          })
          .eq("id", shipmentId);
      }
    }

    return new Response(
      JSON.stringify({ success: callbackStatus === "success", error: errorMessage }),
      {
        status: callbackStatus === "success" ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("site-a-callback error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
