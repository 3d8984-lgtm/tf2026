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

      let orderSuccess = false;
      let orderError: string | null = null;
      let historyIdForImages: string | null = null;

      if (eventType === "order_create") {
        const { data: insertedOrder, error } = await supabase.from("orders").insert(orderData).select("id").single();
        if (error) {
          orderError = error.message;
          await supabase.from("webhook_logs").insert({
            event_type: "order_create_error",
            payload: body,
            status: "error",
            error_message: error.message,
          });
        } else {
          orderSuccess = true;

          // Create upload_history record for API source
          const { data: historyRow } = await supabase.from("upload_history").insert({
            file_name: `API-${orderData.external_order_id}`,
            row_count: orderData.quantity,
            success_count: 1,
            error_count: 0,
            source: "api",
          }).select("id").single();

          // Link order to upload_history
          if (historyRow?.id && insertedOrder?.id) {
            await supabase.from("orders").update({ upload_history_id: historyRow.id }).eq("id", insertedOrder.id);
            historyIdForImages = historyRow.id;
          }
        }
      } else {
        // order_update: upsert by external_order_id
        const { error } = await supabase
          .from("orders")
          .update(orderData)
          .eq("external_order_id", orderData.external_order_id);
        if (error) {
          orderError = error.message;
          await supabase.from("webhook_logs").insert({
            event_type: "order_update_error",
            payload: body,
            status: "error",
            error_message: error.message,
          });
        } else {
          orderSuccess = true;
          // Find existing upload_history_id for image count updates
          const { data: existingOrder } = await supabase
            .from("orders")
            .select("upload_history_id")
            .eq("external_order_id", orderData.external_order_id)
            .maybeSingle();
          historyIdForImages = existingOrder?.upload_history_id ?? null;
        }
      }

      // === Auto-receive design / twincode images from webhook payload ===
      // Accepted shapes (per category):
      //   design_images / twincode_images: Array<{ filename: string, url?: string, base64?: string, content_type?: string }>
      //   Aliases also accepted: order.design_images, order.twincode_images
      if (orderSuccess && !orderError) {
        const folder = orderData.external_order_id;
        const designList: any[] = body.design_images || order.design_images || [];
        const twincodeList: any[] = body.twincode_images || order.twincode_images || [];

        const fetchToBytes = async (entry: any): Promise<{ bytes: Uint8Array; contentType: string } | null> => {
          try {
            if (entry?.base64) {
              const b64 = String(entry.base64).replace(/^data:[^;]+;base64,/, "");
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              return { bytes, contentType: entry.content_type || "image/png" };
            }
            if (entry?.url) {
              const r = await fetch(entry.url);
              if (!r.ok) return null;
              const ct = r.headers.get("content-type") || entry.content_type || "image/png";
              const ab = await r.arrayBuffer();
              return { bytes: new Uint8Array(ab), contentType: ct };
            }
          } catch (_) {
            return null;
          }
          return null;
        };

        const uploadList = async (list: any[], bucket: string): Promise<number> => {
          let saved = 0;
          for (const entry of list) {
            const filename: string = entry?.filename || entry?.name || `${crypto.randomUUID()}.png`;
            const safeName = filename.replace(/[^\w.\-]/g, "_");
            const data = await fetchToBytes(entry);
            if (!data) continue;
            const path = `${folder}/${safeName}`;
            const { error: upErr } = await supabase.storage.from(bucket).upload(path, data.bytes, {
              upsert: true,
              contentType: data.contentType,
            });
            if (!upErr) saved++;
            else {
              await supabase.from("webhook_logs").insert({
                event_type: "image_upload_error",
                payload: { bucket, path, error: upErr.message },
                status: "error",
                error_message: upErr.message,
              });
            }
          }
          return saved;
        };

        let designSaved = 0;
        let twincodeSaved = 0;
        if (designList.length) designSaved = await uploadList(designList, "design-images");
        if (twincodeList.length) twincodeSaved = await uploadList(twincodeList, "twincode-images");

        // Update upload_history image counts (additive)
        if (historyIdForImages && (designSaved > 0 || twincodeSaved > 0)) {
          const { data: hist } = await supabase
            .from("upload_history")
            .select("design_image_count, twincode_image_count")
            .eq("id", historyIdForImages)
            .maybeSingle();
          await supabase
            .from("upload_history")
            .update({
              design_image_count: (hist?.design_image_count || 0) + designSaved,
              twincode_image_count: (hist?.twincode_image_count || 0) + twincodeSaved,
            })
            .eq("id", historyIdForImages);
        }

        if (designList.length || twincodeList.length) {
          await supabase.from("webhook_logs").insert({
            event_type: "images_received",
            payload: {
              external_order_id: folder,
              design_received: designList.length,
              design_saved: designSaved,
              twincode_received: twincodeList.length,
              twincode_saved: twincodeSaved,
            },
            status: "processed",
          });
        }
      }

      if (orderError) {
        return new Response(JSON.stringify({ error: orderError }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update log status to processed
      if (orderSuccess) {
        await supabase
          .from("webhook_logs")
          .update({ status: "processed" })
          .eq("event_type", eventType)
          .eq("status", "received")
          .order("created_at", { ascending: false })
          .limit(1);
      }
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
