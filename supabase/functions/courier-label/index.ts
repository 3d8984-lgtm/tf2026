import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { fpxCall, fpxEndpoint, fpxCancelOrder, FPX_TEST_URL } from "../_shared/fpx.ts";
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
}

// ---- 4PX: ds.xms.order.create (v1.1.0) + ds.xms.label.get (v1.1.0) ----------
async function call4px(cfg: any, cred: any, order: any, shipment: any): Promise<LabelResult> {
  const endpoint = fpxEndpoint(cfg.api_url, cfg.api_mode);
  const extra = (cred?.extra ?? {}) as Record<string, any>;
  const qty = Number(order.quantity ?? 1) || 1;
  const unitPrice = Number(extra.unit_price ?? 10);
  const weight = Math.max(1, Math.round(shipment.weight_grams ?? shipment.expected_weight_grams ?? 200));
  // 4PX는 수취인 정보에 영문/기호만 허용하고 city/state가 필수입니다.
  const rcp = normalizeRecipient(order);
  if (rcp.missing.length) {
    return {
      tracking_number: null,
      label_url: null,
      raw: null,
      error: `수취인 주소 정보가 부족합니다 (${rcp.missing.join(", ")}). 주문 데이터의 도시/주/우편번호를 확인해 주세요.`,
    };
  }



  const bizData = {
    ref_no: order.external_order_id,
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
      phone: (order.recipient_phone ?? "").replace(/[^\d+\-() ]/g, "") || "0000000000",
      post_code: rcp.zip,
      country: rcp.country,
      state: rcp.state,
      city: rcp.city,
      street: rcp.street.slice(0, 90),
      email: extra.recipient_email ?? "",
    },


    deliver_type_info: { deliver_type: String(extra.deliver_type ?? "3") },
  };

  const created = await fpxCall(endpoint, cred, "ds.xms.order.create", "1.1.0", bizData);
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
    { request_no: fpxNo ?? order.external_order_id },
    { request_no: dsNo ?? fpxNo ?? order.external_order_id },
    { request_no: order.external_order_id, ref_no: order.external_order_id },
  ];

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

  return {
    tracking_number: tracking,
    label_url: labelUrl,
    fpx_tracking_no: fpxNo,
    error: labelUrl ? undefined : "4PX label (ds.xms.label.get) was not returned",
    raw: { create: created.raw, label: labelRaw },
  };
}



async function callYunExpress(cfg: any, cred: any, order: any, shipment: any): Promise<LabelResult> {
  const base = (cfg.api_url ?? "").replace(/\/+$/, "");
  const url = `${base}/api/WayBill/CreateOrder`;
  const auth = btoa(`${cred?.account_no ?? ""}&${cred?.api_key ?? ""}`);
  const payload = [
    {
      CustomerOrderNumber: order.external_order_id,
      ShippingMethodCode: cred?.extra?.channel_code ?? "",
      PackageCount: 1,
      Weight: ((shipment.weight_grams ?? shipment.expected_weight_grams ?? 0) / 1000) || 0.1,
      Receiver: (() => {
        const r = normalizeRecipient(order);
        return {
          CountryCode: r.country,
          FirstName: r.first_name,
          LastName: r.last_name,
          Street: r.street,
          City: r.city,
          State: r.state,
          Zip: r.zip,
          Phone: order.recipient_phone ?? "",
        };
      })(),

      Parcels: [
        {
          EName: cred?.extra?.item_name_en ?? "T-Shirt",
          CName: cred?.extra?.item_name_cn ?? "T恤",
          Quantity: order.quantity ?? 1,
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

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: approved } = await admin.rpc("is_approved", { _user_id: user.id });
    if (!approved) return json({ error: "forbidden" }, 403);

    const { shipment_id, carrier, test, test_variant } = await req.json();
    // "sandbox"     -> open-test.4px.com with sandbox credentials
    // "live_cancel" -> production endpoint + real credentials, order is cancelled right after
    const variant: "sandbox" | "live_cancel" = test_variant === "live_cancel" ? "live_cancel" : "sandbox";
    if (!shipment_id || !carrier) return json({ error: "shipment_id and carrier required" }, 400);

    const { data: shipment, error: sErr } = await admin
      .from("shipments")
      .select("*")
      .eq("id", shipment_id)
      .maybeSingle();
    if (sErr || !shipment) return json({ error: "shipment not found" }, 404);
    if (!test && shipment.tracking_number) {
      return json({ ok: true, already: true, tracking_number: shipment.tracking_number, carrier: shipment.carrier });
    }

    const { data: order } = await admin.from("orders").select("*").eq("id", shipment.order_id).maybeSingle();
    if (!order) return json({ error: "order not found" }, 404);

    const { data: cfg } = await admin.from("courier_configs").select("*").eq("code", carrier).maybeSingle();
    if (!cfg) return json({ error: `courier '${carrier}' is not registered` }, 400);
    if (!cfg.enabled) return json({ error: `courier '${cfg.name}' is disabled` }, 400);

    const { data: cred } = await admin.from("courier_credentials").select("*").eq("code", carrier).maybeSingle();
    if (!cred?.api_key && !cred?.api_secret) {
      return json({ error: `API credentials for '${cfg.name}' are not configured` }, 400);
    }

    // ---- TEST MODE ----------------------------------------------------------
    // sandbox     : open-test.4px.com with sandbox credentials.
    // live_cancel : production endpoint with the real credentials; the test order is
    //               cancelled immediately after the label is fetched.
    if (test) {
      let authOk = false;
      let message = "";
      let tracking = "";
      let labelUrl: string | null = null;
      let raw: unknown = null;
      let cancelInfo: unknown = null;

      try {
        if (carrier === "4px") {
          const extra = (cred.extra ?? {}) as Record<string, any>;
          const useLive = variant === "live_cancel";
          const endpoint = useLive ? fpxEndpoint(cfg.api_url, cfg.api_mode ?? "prod") : FPX_TEST_URL;
          const useCred = useLive
            ? cred
            : {
                api_key: extra.test_app_key ?? "eb190f3b-d464-4e3f-a6f1-036399670823",
                api_secret: extra.test_app_secret ?? "79df01f8-63d5-47f3-a1e3-3e43ceecf726",
                extra: { ...extra, channel_code: extra.test_channel_code ?? extra.channel_code ?? "PY" },
              };

          const refNo = `TEST-${order.external_order_id}-${Date.now()}`;
          const testOrder = { ...order, external_order_id: refNo };
          const r = await call4px(
            { api_url: endpoint, api_mode: useLive ? (cfg.api_mode ?? "prod") : "test" },
            useCred,
            testOrder,
            shipment,
          );
          raw = r.raw;
          if (r.tracking_number) {
            authOk = true;
            tracking = r.tracking_number;
            labelUrl = r.label_url;
            message = useLive ? "4PX live test waybill created" : "4PX sandbox test waybill created";

            if (useLive) {
              const c = await fpxCancelOrder(endpoint, useCred, refNo, r.fpx_tracking_no ?? null);
              cancelInfo = c;
              message += c.ok
                ? ` / cancelled (${c.method})`
                : " / CANCEL FAILED - cancel this order manually in the 4PX console";
            }
          } else if (!tracking) {
            authOk = false;
            const err = r.error ?? "no tracking number";
            const hint = /000012|签名|sign/i.test(err)
              ? " → 주문생성(ds.xms.order.create)은 access_token 인증이 필요합니다. 택배사 설정에서 4PX access_token과 물류상품코드(logistics_product_code)를 입력해 주세요."
              : /product|channel|物流|产品/i.test(err)
              ? " → 물류상품코드(channel_code)가 유효한지 확인해 주세요."
              : "";
            message = `${useLive ? "live" : "sandbox"} order: ${err}${hint}`;
          }

        } else {
          authOk = true;
          message = "test mode (no live auth check for this carrier)";
        }
      } catch (e) {
        message = e instanceof Error ? e.message : "network error";
      }

      if (!tracking) {
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
        tracking = `TEST-${carrier.toUpperCase()}-${stamp}-${rnd}`;
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
          raw: typeof raw === "string" ? raw.slice(0, 2000) : raw,
        },
      });

      if (!authOk) return json({ error: message, raw }, 502);

      return json({
        ok: true,
        test: true,
        test_variant: variant,
        carrier,
        tracking_number: tracking,
        label_url: labelUrl,
        cancelled: (cancelInfo as any)?.ok ?? null,
        message,
      });
    }



    let result: LabelResult;
    if (carrier === "4px") result = await call4px(cfg, cred, order, shipment);
    else if (carrier === "yunexpress") result = await callYunExpress(cfg, cred, order, shipment);
    else return json({ error: `no API adapter for '${carrier}'` }, 400);

    await admin.from("shipping_logs").insert({
      shipment_id: shipment.id,
      order_id: shipment.order_id,
      action_type: result.tracking_number ? "carrier_api_success" : "carrier_api_fail",
      worker_id: user.id,
      details: { carrier, mode: cfg.api_mode, error: result.error ?? null },
    });

    if (!result.tracking_number) {
      return json({ error: result.error ?? "carrier did not return a tracking number", raw: result.raw }, 502);
    }

    const { error: uErr } = await admin
      .from("shipments")
      .update({
        carrier,
        tracking_number: result.tracking_number,
        label_url: result.label_url,
        status: "label_received",
        scan_status: "ready",
        tracking_issued_at: new Date().toISOString(),
        carrier_response: result.raw && typeof result.raw === "object" ? result.raw : { raw: String(result.raw) },
      })
      .eq("id", shipment.id);
    if (uErr) return json({ error: uErr.message }, 400);

    return json({
      ok: true,
      carrier,
      tracking_number: result.tracking_number,
      label_url: result.label_url,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
