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
        external_order_id:
          order.order_id || order.orderId || order.external_order_id || order.id || order.work_order_no,
        product_code: order.product_code || order.tshirt_type || order.sku || order.종류 || "",
        design_code: order.design_code || order.issued_no || order["ISSUED No."] || null,
        quantity: order.quantity || order.qty || 1,
        recipient_name:
          order.recipient_name || order.twinker_name || order.트윙커명 || order.수취인명 || order.name || "",
        recipient_phone: order.recipient_phone || order.phone || order.연락처 || null,
        shipping_address: order.shipping_address || order.address || order.주소 || "",
        shipping_city: order.shipping_city || order.city || null,
        shipping_state: order.shipping_state || order.state || null,
        shipping_zip: order.shipping_zip || order.zip || order.zipcode || order.우편번호 || null,
        shipping_country:
          order.shipping_country || order.country || order.country_code || order.국가코드 || "US",
        project_completed_at:
          order.project_completed_at || order.ship_date || order.발송_예정일 || order["발송 예정일"] || null,
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

        // ---- Validation helpers ----
        const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
        const ALLOWED_MIME = new Set([
          "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
        ]);
        const extOf = (name: string): string => {
          const m = /\.([A-Za-z0-9]+)$/.exec(name || "");
          return m ? m[1].toLowerCase() : "";
        };
        const isValidHttpUrl = (u: string): boolean => {
          try {
            const parsed = new URL(u);
            return parsed.protocol === "http:" || parsed.protocol === "https:";
          } catch { return false; }
        };
        const isValidBase64 = (s: string): boolean => {
          const stripped = s.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
          if (!stripped.length) return false;
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(stripped)) return false;
          if (stripped.length % 4 !== 0) return false;
          try { atob(stripped.slice(0, Math.min(stripped.length, 64))); return true; } catch { return false; }
        };

        type ValidationFailure = {
          filename: string | null;
          reason: string;
          bucket: string;
          index: number;
        };
        const failures: ValidationFailure[] = [];

        const validateAndDedupe = (list: any[], bucket: string) => {
          const seen = new Set<string>();
          const valid: { entry: any; safeName: string }[] = [];
          list.forEach((entry, idx) => {
            const rawName: string | undefined = entry?.filename || entry?.name;
            const reject = (reason: string) =>
              failures.push({ filename: rawName ?? null, reason, bucket, index: idx });

            // 1) filename required
            if (!rawName || typeof rawName !== "string" || !rawName.trim()) {
              reject("missing_filename"); return;
            }
            // 2) extension allow-list
            const ext = extOf(rawName);
            if (!ext || !ALLOWED_EXT.has(ext)) {
              reject(`invalid_extension:${ext || "none"}`); return;
            }
            // 3) content_type (if provided) must match image mime allow-list
            if (entry.content_type && !ALLOWED_MIME.has(String(entry.content_type).toLowerCase())) {
              reject(`invalid_content_type:${entry.content_type}`); return;
            }
            // 4) must have either url or base64
            if (!entry.url && !entry.base64) {
              reject("missing_source"); return;
            }
            // 5) url format
            if (entry.url && !isValidHttpUrl(String(entry.url))) {
              reject("invalid_url"); return;
            }
            // 6) base64 format
            if (entry.base64 && !isValidBase64(String(entry.base64))) {
              reject("invalid_base64"); return;
            }
            // 7) duplicate filename within same category
            const safeName = rawName.replace(/[^\w.\-]/g, "_");
            const key = safeName.toLowerCase();
            if (seen.has(key)) {
              reject("duplicate_filename"); return;
            }
            seen.add(key);
            valid.push({ entry, safeName });
          });
          return valid;
        };

        const validDesign = validateAndDedupe(designList, "design-images");
        const validTwincode = validateAndDedupe(twincodeList, "twincode-images");

        // Log all validation failures up front (one row per failed image)
        if (failures.length) {
          await supabase.from("webhook_logs").insert(
            failures.map((f) => ({
              event_type: "image_validation_failed",
              payload: {
                external_order_id: folder,
                bucket: f.bucket,
                index: f.index,
                filename: f.filename,
                reason: f.reason,
              },
              status: "error",
              error_message: `Image skipped (${f.reason})${f.filename ? `: ${f.filename}` : ""}`,
            })),
          );
        }

        const fetchToBytes = async (entry: any): Promise<{ bytes: Uint8Array; contentType: string } | null> => {
          try {
            if (entry?.base64) {
              const b64 = String(entry.base64).replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              return { bytes, contentType: entry.content_type || "image/png" };
            }
            if (entry?.url) {
              const r = await fetch(entry.url);
              if (!r.ok) return null;
              const ct = r.headers.get("content-type") || entry.content_type || "image/png";
              if (!ALLOWED_MIME.has(ct.split(";")[0].trim().toLowerCase())) return null;
              const ab = await r.arrayBuffer();
              return { bytes: new Uint8Array(ab), contentType: ct };
            }
          } catch (_) {
            return null;
          }
          return null;
        };

        const uploadValid = async (
          items: { entry: any; safeName: string }[],
          bucket: string,
        ): Promise<number> => {
          let saved = 0;
          for (const { entry, safeName } of items) {
            const data = await fetchToBytes(entry);
            const path = `${folder}/${safeName}`;
            if (!data) {
              await supabase.from("webhook_logs").insert({
                event_type: "image_fetch_failed",
                payload: { bucket, path, filename: safeName },
                status: "error",
                error_message: `Image fetch/decode failed: ${safeName}`,
              });
              continue;
            }
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

        const designSaved = validDesign.length ? await uploadValid(validDesign, "design-images") : 0;
        const twincodeSaved = validTwincode.length ? await uploadValid(validTwincode, "twincode-images") : 0;

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
              design_valid: validDesign.length,
              design_saved: designSaved,
              twincode_received: twincodeList.length,
              twincode_valid: validTwincode.length,
              twincode_saved: twincodeSaved,
              skipped: failures.length,
              failures: failures.map((f) => ({
                bucket: f.bucket,
                filename: f.filename,
                reason: f.reason,
              })),
            },
            status: failures.length ? "partial" : "processed",
          });
        }
      }

      if (orderError) {
        return new Response(JSON.stringify({ error: orderError }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update log status to processed (target the most recent matching row by id)
      if (orderSuccess) {
        const { data: latest } = await supabase
          .from("webhook_logs")
          .select("id")
          .eq("event_type", eventType)
          .eq("status", "received")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest?.id) {
          await supabase
            .from("webhook_logs")
            .update({ status: "processed" })
            .eq("id", latest.id);
        }
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
