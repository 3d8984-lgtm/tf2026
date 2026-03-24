import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Optional secret validation
    const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
    if (webhookSecret) {
      const provided = req.headers.get("x-webhook-secret");
      if (provided !== webhookSecret) {
        await supabase.from("webhook_logs").insert({
          event_type: "auth_failed",
          payload: { error: "Invalid webhook secret" },
          status: "error",
          error_message: "Invalid or missing x-webhook-secret header",
        });
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json();
    const eventType = body.event_type || "order_create";

    // Log the incoming webhook
    await supabase.from("webhook_logs").insert({
      event_type: eventType,
      payload: body,
      status: "received",
      source: body.source || "site_a",
    });

    if (eventType === "order_create" || eventType === "order_update") {
      const order = body.order || body;

      const orderData = {
        external_order_id: order.external_order_id || order.order_id || order.id,
        product_code: order.product_code || order.sku || "",
        design_code: order.design_code || order.design || null,
        quantity: order.quantity || order.qty || 1,
        recipient_name: order.recipient_name || order.name || "",
        recipient_phone: order.recipient_phone || order.phone || null,
        shipping_address: order.shipping_address || order.address || "",
        shipping_city: order.shipping_city || order.city || null,
        shipping_state: order.shipping_state || order.state || null,
        shipping_zip: order.shipping_zip || order.zip || null,
        shipping_country: order.shipping_country || order.country || "US",
        source_data: body,
        status: "received" as const,
      };

      if (eventType === "order_create") {
        const { error } = await supabase.from("orders").insert(orderData);
        if (error) {
          await supabase.from("webhook_logs").insert({
            event_type: "order_create_error",
            payload: body,
            status: "error",
            error_message: error.message,
          });
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        // order_update: upsert by external_order_id
        const { error } = await supabase
          .from("orders")
          .update(orderData)
          .eq("external_order_id", orderData.external_order_id);
        if (error) {
          await supabase.from("webhook_logs").insert({
            event_type: "order_update_error",
            payload: body,
            status: "error",
            error_message: error.message,
          });
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Update log status to processed
      await supabase
        .from("webhook_logs")
        .update({ status: "processed" })
        .eq("event_type", eventType)
        .eq("status", "received")
        .order("created_at", { ascending: false })
        .limit(1);
    }

    return new Response(
      JSON.stringify({ success: true, event_type: eventType }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await supabase.from("webhook_logs").insert({
      event_type: "parse_error",
      payload: { raw: "failed to parse" },
      status: "error",
      error_message: errorMsg,
    });
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
