import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { fpxCall, fpxEndpoint, fpxCancelOrder } from "../_shared/fpx.ts";
import { normalizeRecipient } from "../_shared/addr.ts";


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

interface LabelResult {
  tracking_number: string | null;
  label_url: string | null;
  raw: unknown;
  error?: string;
  fpx_tracking_no?: string | null;
  ref_no?: string | null;
}

/**
 * 배송 수취인은 반드시 `source_data.items[]`(엑셀 Q~T열)의 값을 사용합니다.
 * `orders.recipient_name`은 트윈커명(C열)이 우선 저장되어 있어 배송에 사용하지 않습니다.
 */
function shippingRecipient(order: any, position?: number) {
  const items: any[] = Array.isArray(order?.source_data?.items) ? order.source_data.items : [];
  const idx = Math.max(1, Number(position ?? 1)) - 1;
  const it = items[idx] ?? items[0] ?? {};
  const name = String(it.recipient_name ?? "").trim();
  return {
    recipient_name: name,
    recipient_phone: String(it.recipient_phone ?? order?.recipient_phone ?? "").trim(),
    shipping_address: String(it.shipping_address ?? order?.shipping_address ?? "").trim(),
    shipping_city: it.shipping_city ?? order?.shipping_city ?? null,
    shipping_state: it.shipping_state ?? order?.shipping_state ?? null,
    shipping_zip: String(it.shipping_zip ?? order?.shipping_zip ?? "").trim(),
    shipping_country: String(it.country_code ?? order?.shipping_country ?? "US").trim(),
  };
}

type Mark = (step: string) => void;
const noopMark: Mark = () => {};

// ---- 4PX: ds.xms.order.create (v1.1.0) + ds.xms.label.get (v1.1.0) ----------
async function call4px(cfg: any, cred: any, order: any, shipment: any, position?: number, mark: Mark = noopMark, qtyOverride?: number): Promise<LabelResult> {
  const endpoint = fpxEndpoint(cfg.api_url, cfg.api_mode);
  const extra = (cred?.extra ?? {}) as Record<string, any>;
  // 소포 1건 = 티셔츠 1개 (주소록 1행). 발송 그룹(동일 수취인 묶음)이면 그룹의 제품수량을 사용합니다.
  const qty = Math.max(1, Number(qtyOverride ?? 1));
  const unitPrice = Number(extra.unit_price ?? 10);
  const baseWeight = Math.max(1, Math.round(shipment.weight_grams ?? shipment.expected_weight_grams ?? 200));
  const weight = baseWeight * qty;
  // 4PX는 수취인 정보에 영문/기호만 허용하고 city/state가 필수입니다.
  const ship = shippingRecipient(order, position);
  if (!ship.recipient_name) {
    return {
      tracking_number: null,
      label_url: null,
      raw: null,
      error: "배송 수취인명이 없습니다. 엑셀 Q열(수취인명)을 확인해 주세요. (트윈커명은 배송에 사용하지 않습니다)",
    };
  }
  const rcp = normalizeRecipient(ship);
  if (rcp.missing.length) {
    return {
      tracking_number: null,
      label_url: null,
      raw: null,
      error: `수취인 주소 정보가 부족합니다 (${rcp.missing.join(", ")}). 주문 데이터의 도시/주/우편번호를 확인해 주세요.`,
    };
  }

  // 4PX 라벨의 "Ref No" 칸에는 ref_no 값이 그대로 인쇄됩니다.
  // 수취인이 물품 내용/발송처를 알 수 있도록 브랜드+영문 품명을 사용하되,
  // 4PX는 ref_no를 주문 고유키로 취급하므로(공백 불가, 중복 시 "in processing" 오류)
  // 공백은 하이픈으로 바꾸고 발송건별 고유 접미사를 붙입니다. (최대 32자)
  const refLabel = String(
    extra.ref_label ?? [extra.brand, extra.item_name_en].filter(Boolean).join(" "),
  )
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
  const uniqSuffix = (String(order.external_order_id ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(-8) || Date.now().toString(36).toUpperCase().slice(-8));
  const refNo = `${refLabel.slice(0, Math.max(0, 31 - uniqSuffix.length))}-${uniqSuffix}`
    .replace(/^-/, "")
    .slice(0, 32);



  const bizData = {
    ref_no: refNo,

    business_type: "BDS",
    duty_type: extra.duty_type ?? "P",
    logistics_service_info: {
      logistics_product_code: extra.channel_code ?? extra.logistics_product_code ?? "",
    },
    return_info: {
      is_return_on_domestic: extra.is_return_on_domestic ?? "N",
      is_return_on_oversea: extra.is_return_on_oversea ?? (extra.returner_street ? "Y" : "N"),
    },

    parcel_list: [
      {
        weight,
        parcel_value: Number((unitPrice * qty).toFixed(2)),
        currency: "USD",
        include_battery: "N",
        declare_product_info: [
          {
            declare_product_name_cn: extra.item_name_cn ?? "T恤",
            declare_product_name_en: extra.item_name_en ?? "T-Shirt",
            declare_product_code_qty: String(qty),
            declare_unit_price_export: unitPrice,
            currency_export: "USD",
            declare_unit_price_import: unitPrice,
            currency_import: "USD",
            brand_export: extra.brand ?? "",
            brand_import: extra.brand ?? "",
            hscode_export: extra.hscode ?? "",
            hscode_import: extra.hscode ?? "",
          },
        ],
      },
    ],
    is_insure: "N",
    sender: {
      first_name: extra.sender_name ?? "TWINMETA",
      company: extra.sender_company ?? "TWINMETA",
      phone: extra.sender_phone ?? "13000000000",
      post_code: extra.sender_post_code ?? "518000",
      country: extra.sender_country ?? "CN",
      state: extra.sender_state ?? "GuangDong",
      city: extra.sender_city ?? "Shenzhen",
      street: String(extra.sender_street ?? "-").slice(0, 90),
    },
    // 반품지(반송지) 주소 — 설정된 경우에만 전송 (미설정 시 4PX 기본값 = 발송인 주소)
    ...(extra.returner_street || extra.returner_name
      ? {
          returner: {
            first_name: extra.returner_name ?? extra.sender_name ?? "TWINMETA",
            company: extra.returner_company ?? "",
            phone: extra.returner_phone ?? "",
            post_code: extra.returner_post_code ?? "",
            country: extra.returner_country ?? "US",
            state: extra.returner_state ?? "",
            city: extra.returner_city ?? "",
            street: String(extra.returner_street ?? "-").slice(0, 90),
          },
        }
      : {}),

    recipient_info: {
      first_name: rcp.first_name,
      last_name: rcp.last_name,
      phone: (ship.recipient_phone ?? "").replace(/[^\d+\-() ]/g, "") || "0000000000",
      post_code: rcp.zip,
      country: rcp.country,
      state: rcp.state,
      city: rcp.city,
      street: rcp.street.slice(0, 90),
      email: extra.recipient_email ?? "",
    },


    deliver_type_info: { deliver_type: String(extra.deliver_type ?? "3") },
  };

  mark("4PX_create_start");
  const created = await fpxCall(endpoint, cred, "ds.xms.order.create", "1.1.0", bizData);
  mark("4PX_create_end");
  if (!created.ok) {
    return {
      tracking_number: null,
      label_url: null,
      raw: created.raw,
      error: created.message ?? created.code ?? `HTTP ${created.httpStatus}`,
    };
  }

  const d = created.data ?? {};
  const fpxNo = d["4px_tracking_no"] ?? d.fpx_tracking_no ?? d.tracking_no ?? null;
  const tracking =
    d.logistics_channel_no || d.channel_tracking_no || d.tracking_number || fpxNo;
  if (!tracking) {
    return {
      tracking_number: null,
      label_url: null,
      raw: created.raw,
      error: `4PX order.create returned no tracking number (code=${created.code ?? "-"}, msg=${
        created.message ?? "-"
      }, data=${JSON.stringify(d).slice(0, 500)})`,
    };
  }

  // Label: always use the carrier-issued waybill (4PX ds.xms.label.get, 100x150mm).
  // 4PX may answer with a URL, or with the file itself as base64 (PDF) / raw HTML.
  let labelUrl: string | null = null;
  let labelRaw: unknown = null;
  // 4PX ds.xms.label.get requires `request_no` (the 4PX tracking / consignment no).
  const dsNo = d.ds_consignment_no ?? null;
  const attempts = [
    { request_no: fpxNo ?? refNo },
    { request_no: dsNo ?? fpxNo ?? refNo },
    { request_no: refNo, ref_no: refNo },

  ];

  mark("4PX_label_start");
  for (const key of attempts) {
    if (labelUrl) break;
    try {
      const label = await fpxCall(endpoint, cred, "ds.xms.label.get", "1.1.0", {
        ...key,
        label_size: extra.label_size ?? "label_100x150",
        is_print_pick_info: "N",
        is_print_merge: "N",
      });
      labelRaw = label.raw;
      const ld = label.data ?? {};
      const first = Array.isArray(ld.label_list) ? ld.label_list[0] ?? {} : {};
      const info = ld.label_url_info ?? first.label_url_info ?? {};
      const direct =
        info.logistics_label ?? info.label_url ?? info.url ??
        ld.label_url ?? ld.url ?? ld.file_url ?? first.label_url ?? first.url ?? null;
      const b64 =
        ld.label_content ?? ld.file_content ?? ld.content ?? ld.label_data ??
        first.label_content ?? first.content ?? null;
      if (direct) {
        labelUrl = String(direct).replace(/^http:\/\/bss-fss\.4px\.com\//i, "https://bss-fss.4px.com/");
      }
      else if (typeof b64 === "string" && b64.length > 100) {
        const clean = b64.replace(/\s/g, "");
        const isHtml = /^(PCFE|PGh0|PGRp|PHN2)/.test(clean) || /^\s*</.test(b64);
        labelUrl = `data:${isHtml ? "text/html" : "application/pdf"};base64,${clean}`;
      }
    } catch { /* try the next parameter combination */ }
  }
  mark("4PX_label_end");

  return {
    tracking_number: tracking,
    label_url: labelUrl,
    fpx_tracking_no: fpxNo,
    ref_no: refNo,
    error: labelUrl ? undefined : "4PX label (ds.xms.label.get) was not returned",
    raw: { create: created.raw, label: labelRaw },
  };
}



async function callYunExpress(cfg: any, cred: any, order: any, shipment: any, position?: number, qtyOverride?: number): Promise<LabelResult> {
  const qty = Math.max(1, Number(qtyOverride ?? 1));
  const base = (cfg.api_url ?? "").replace(/\/+$/, "");
  const url = `${base}/api/WayBill/CreateOrder`;
  const auth = btoa(`${cred?.account_no ?? ""}&${cred?.api_key ?? ""}`);
  const payload = [
    {
      CustomerOrderNumber: order.external_order_id,
      ShippingMethodCode: cred?.extra?.channel_code ?? "",
      PackageCount: 1,
      Weight: (((shipment.weight_grams ?? shipment.expected_weight_grams ?? 0) / 1000) || 0.1) * qty,
      Receiver: (() => {
        const r = normalizeRecipient(shippingRecipient(order, position));
        return {
          CountryCode: r.country,
          FirstName: r.first_name,
          LastName: r.last_name,
          Street: r.street,
          City: r.city,
          State: r.state,
          Zip: r.zip,
          Phone: shippingRecipient(order, position).recipient_phone,
        };
      })(),

      Parcels: [
        {
          EName: cred?.extra?.item_name_en ?? "T-Shirt",
          CName: cred?.extra?.item_name_cn ?? "T恤",
          Quantity: qty,
          UnitPrice: Number(cred?.extra?.unit_price ?? 10),
          UnitWeight: 0.2,
          Currency: "USD",
        },
      ],
    },
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}`, Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let raw: any = text;
  try { raw = JSON.parse(text); } catch { /* keep text */ }

  const item = Array.isArray(raw?.Item) ? raw.Item[0] : raw?.Item ?? raw?.Data?.[0] ?? null;
  const tracking = item?.TrackingNumber ?? item?.WayBillNumber ?? raw?.TrackingNumber ?? null;
  const label = item?.LabelUrl ?? item?.ShippingLabelUrl ?? null;
  if (!res.ok || !tracking) {
    return {
      tracking_number: null,
      label_url: null,
      raw,
      error: item?.Message ?? raw?.ResultDesc ?? raw?.Message ?? `HTTP ${res.status}`,
    };
  }
  return { tracking_number: tracking, label_url: label, raw };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  const timings: { step: string; ms: number }[] = [];
  const mark: Mark = (step) => timings.push({ step, ms: Date.now() - t0 });
  mark("edge_function_start");

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: approved } = await admin.rpc("is_approved", { _user_id: user.id });
    if (!approved) return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const { carrier, test, test_variant, item_position, shipping_group_id } = body;
    let { shipment_id } = body;
    // Test mode now only supports the production endpoint with real credentials;
    // the created waybill is cancelled immediately after the label is fetched.
    const variant: "live_cancel" = test_variant === "live_cancel" ? "live_cancel" : "live_cancel";
    if (!carrier) return json({ error: "carrier required" }, 400);

    // ---- SHIPPING GROUP (pre-issue) ----------------------------------------
    // One shipping group (same recipient name/phone/address/zip) = exactly one
    // waybill, whatever the number of orders it contains.
    let group: any = null;
    if (shipping_group_id) {
      const { data: g } = await admin.from("shipping_groups").select("*").eq("id", shipping_group_id).maybeSingle();
      if (!g) return json({ error: "shipping group not found" }, 404);
      if (g.tracking_number && g.label_status === "ready") {
        return json({ ok: true, already: true, tracking_number: g.tracking_number, label_url: g.label_url, carrier: g.carrier });
      }
      // Idempotent claim: only one caller may flip pending/failed -> issuing.
      const { data: claimed } = await admin
        .from("shipping_groups")
        .update({ label_status: "issuing", label_error: null })
        .eq("id", g.id)
        .in("label_status", ["pending", "failed"])
        .select("id")
        .maybeSingle();
      if (!claimed) return json({ ok: true, already: true, busy: true, tracking_number: g.tracking_number, label_url: g.label_url });
      group = g;

      const { data: firstItem } = await admin
        .from("shipment_scan_items")
        .select("shipment_id, order_id, position")
        .eq("shipping_group_id", g.id)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!firstItem) {
        await admin.from("shipping_groups").update({ label_status: "failed", label_error: "no scan items linked" }).eq("id", g.id);
        return json({ error: "shipping group has no linked items" }, 400);
      }
      shipment_id = firstItem.shipment_id;
    }

    if (!shipment_id) return json({ error: "shipment_id and carrier required" }, 400);

    const { data: shipment, error: sErr } = await admin
      .from("shipments")
      .select("*")
      .eq("id", shipment_id)
      .maybeSingle();
    if (sErr || !shipment) return json({ error: "shipment not found" }, 404);
    if (!test && !group && shipment.tracking_number) {
      return json({ ok: true, already: true, tracking_number: shipment.tracking_number, carrier: shipment.carrier });
    }

    const { data: orderRow } = await admin.from("orders").select("*").eq("id", shipment.order_id).maybeSingle();
    if (!orderRow) return json({ error: "order not found" }, 404);

    // For a group we build a synthetic order whose single shipping item carries
    // the group recipient, and a unique ref_no so 4PX never merges waybills.
    const order = group
      ? {
          ...orderRow,
          external_order_id: `${orderRow.external_order_id}-G${String(group.id).slice(0, 8)}`,
          source_data: {
            ...(orderRow.source_data ?? {}),
            items: [
              {
                recipient_name: group.recipient_name,
                recipient_phone: group.recipient_phone,
                shipping_address: group.shipping_address,
                shipping_city: group.shipping_city,
                shipping_state: group.shipping_state,
                shipping_zip: group.shipping_zip,
                country_code: group.shipping_country,
              },
            ],
          },
        }
      : orderRow;


    const { data: cfg } = await admin.from("courier_configs").select("*").eq("code", carrier).maybeSingle();
    if (!cfg) return json({ error: `courier '${carrier}' is not registered` }, 400);
    if (!cfg.enabled) return json({ error: `courier '${cfg.name}' is disabled` }, 400);

    const { data: cred } = await admin.from("courier_credentials").select("*").eq("code", carrier).maybeSingle();
    if (!cred?.api_key && !cred?.api_secret) {
      return json({ error: `API credentials for '${cfg.name}' are not configured` }, 400);
    }
    mark("DB_queries_end");

    // ---- TEST MODE ----------------------------------------------------------
    // Always uses the production endpoint with real credentials; the test order is
    // cancelled immediately after the label is fetched.
    if (test) {
      let authOk = false;
      let message = "";
      let tracking = "";
      let labelUrl: string | null = null;
      let raw: unknown = null;
      let cancelInfo: unknown = null;

      try {
        if (carrier === "4px") {
          const endpoint = fpxEndpoint(cfg.api_url, cfg.api_mode ?? "prod");
          const refNo = `TEST-${order.external_order_id}-${Date.now()}`;
          const testOrder = { ...order, external_order_id: refNo };
          const r = await call4px(
            { api_url: endpoint, api_mode: cfg.api_mode ?? "prod" },
            cred,
            testOrder,
            shipment,
            item_position,
            mark,
          );
          raw = r.raw;
          if (r.tracking_number) {
            authOk = true;
            tracking = r.tracking_number;
            labelUrl = r.label_url;
            message = "4PX live test waybill created";

            const c = await fpxCancelOrder(endpoint, cred, refNo, r.fpx_tracking_no ?? null);
            cancelInfo = c;
            message += c.ok
              ? ` / cancelled (${c.method})`
              : " / CANCEL FAILED - cancel this order manually in the 4PX console";
          } else {
            authOk = false;
            const err = r.error ?? "no tracking number";
            const hint = /000012|签名|sign/i.test(err)
              ? " → 주문생성(ds.xms.order.create)은 access_token 인증이 필요합니다. 택배사 설정에서 4PX access_token과 물류상품코드(logistics_product_code)를 입력해 주세요."
              : /product|channel|物流|产品/i.test(err)
              ? " → 물류상품코드(channel_code)가 유효한지 확인해 주세요."
              : "";
            message = `live order: ${err}${hint}`;
          }

        } else {
          authOk = true;
          message = "test mode (no live auth check for this carrier)";
        }
      } catch (e) {
        message = e instanceof Error ? e.message : "network error";
      }

      // No fabricated tracking numbers: if 4PX did not return a waybill, stop.
      if (!tracking) {
        authOk = false;
        message = message || "4PX did not return a tracking number - aborted (no simulated label)";
      }


      await admin.from("shipping_logs").insert({
        shipment_id: shipment.id,
        order_id: shipment.order_id,
        action_type: "carrier_api_test",
        worker_id: user.id,
        details: {
          carrier,
          mode: variant,
          auth_ok: authOk,
          message,
          tracking_number: tracking,
          cancel: cancelInfo,
          timings,
          total_ms: Date.now() - t0,
          raw: typeof raw === "string" ? raw.slice(0, 2000) : raw,
        },
      });

      if (!authOk) return json({ error: message, raw, timings }, 502);

      mark("edge_response");
      return json({
        ok: true,
        test: true,
        test_variant: variant,
        carrier,
        tracking_number: tracking,
        label_url: labelUrl,
        cancelled: (cancelInfo as any)?.ok ?? null,
        message,
        timings,
        total_ms: Date.now() - t0,
      });
    }



    const groupQty = group ? Math.max(1, Number(group.item_count ?? 1)) : 1;
    let result: LabelResult;
    if (carrier === "4px") result = await call4px(cfg, cred, order, shipment, group ? 1 : item_position, mark, groupQty);
    else if (carrier === "yunexpress") result = await callYunExpress(cfg, cred, order, shipment, group ? 1 : item_position, groupQty);
    else {
      if (group) await admin.from("shipping_groups").update({ label_status: "failed", label_error: `no API adapter for '${carrier}'` }).eq("id", group.id);
      return json({ error: `no API adapter for '${carrier}'` }, 400);
    }
    mark("carrier_api_end");

    await admin.from("shipping_logs").insert({
      shipment_id: shipment.id,
      order_id: shipment.order_id,
      action_type: result.tracking_number ? "label_preissue_success" : "label_preissue_failed",
      worker_id: user.id,
      details: {
        carrier,
        mode: cfg.api_mode,
        shipping_group_id: group?.id ?? null,
        quantity: groupQty,
        tracking_number: result.tracking_number ?? null,
        error: result.error ?? null,
        timings,
        elapsed_ms: Date.now() - t0,
        total_ms: Date.now() - t0,
      },
    });

    if (!result.tracking_number) {
      if (group) {
        await admin
          .from("shipping_groups")
          .update({ label_status: "failed", label_error: String(result.error ?? "no tracking number").slice(0, 500) })
          .eq("id", group.id);
      }
      return json({ error: result.error ?? "carrier did not return a tracking number", raw: result.raw, timings }, 502);
    }

    const issuedAt = new Date().toISOString();

    if (group) {
      const { error: gErr } = await admin
        .from("shipping_groups")
        .update({
          carrier,
          tracking_number: result.tracking_number,
          label_url: result.label_url,
          ref_no: result.ref_no ?? null,
          label_status: "ready",
          label_error: null,
          label_issued_at: issuedAt,
        })
        .eq("id", group.id);
      if (gErr) {
        await admin.from("shipping_groups").update({ label_status: "failed", label_error: gErr.message }).eq("id", group.id);
        return json({ error: gErr.message }, 400);
      }
      // Mirror onto the linked rows so existing list UIs keep working.
      await admin
        .from("shipment_scan_items")
        .update({ carrier, tracking_number: result.tracking_number, label_url: result.label_url, tracking_issued_at: issuedAt })
        .eq("shipping_group_id", group.id);

      mark("edge_response");
      return json({
        ok: true,
        shipping_group_id: group.id,
        carrier,
        tracking_number: result.tracking_number,
        label_url: result.label_url,
        ref_no: result.ref_no ?? null,
        timings,
        total_ms: Date.now() - t0,
      });
    }

    const { error: uErr } = await admin
      .from("shipments")
      .update({
        carrier,
        tracking_number: result.tracking_number,
        label_url: result.label_url,
        status: "label_received",
        scan_status: "ready",
        tracking_issued_at: issuedAt,
        carrier_response: result.raw && typeof result.raw === "object" ? result.raw : { raw: String(result.raw) },
      })
      .eq("id", shipment.id);
    if (uErr) return json({ error: uErr.message }, 400);

    mark("edge_response");
    return json({
      ok: true,
      carrier,
      tracking_number: result.tracking_number,
      label_url: result.label_url,
      timings,
      total_ms: Date.now() - t0,
    });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
