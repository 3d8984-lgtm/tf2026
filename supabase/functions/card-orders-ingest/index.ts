import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/**
 * Public endpoint to ingest a card order from an external API.
 *
 * POST /functions/v1/card-orders-ingest
 * Body: { template_id: uuid, order_name: string, items: Array<Record<string, any>> }
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { template_id, order_name, items } = body ?? {};
    if (!template_id || !order_name || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "template_id, order_name, items[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: order, error: oErr } = await supabase
      .from("card_order")
      .insert({ template_id, order_name, status: "ready" })
      .select()
      .single();
    if (oErr) throw oErr;

    const rows = items.map((d: any) => ({ order_id: order.id, data: d }));
    const { error: iErr } = await supabase.from("card_order_item").insert(rows);
    if (iErr) throw iErr;

    return new Response(
      JSON.stringify({ order_id: order.id, item_count: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("card-orders-ingest error", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
