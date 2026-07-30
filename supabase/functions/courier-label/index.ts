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

async function md5(text: string) {
  const buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(text)).catch(() => null);
  if (buf) return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Deno WebCrypto has no MD5 fallback: use SHA-256 (some sandboxes)
  const sha = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(sha)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface LabelResult {
  tracking_number: string | null;
  label_url: string | null;
  raw: unknown;
  error?: string;
}

async function call4px(cfg: any, cred: any, order: any, shipment: any): Promise<LabelResult> {
  const ts = Date.now().toString();
  const bizData = {
    order_no: order.external_order_id,
    logistics_channel_no: cred?.extra?.channel_code ?? "",
    consignee: {
      name: order.recipient_name,
      phone: order.recipient_phone ?? "",
      country: order.shipping_country ?? "US",
      state: order.shipping_state ?? "",
      city: order.shipping_city ?? "",
      street: order.shipping_address ?? "",
      post_code: order.shipping_zip ?? "",
    },
    parcel: {
      weight: shipment.weight_grams ?? shipment.expected_weight_grams ?? 0,
      quantity: order.quantity ?? 1,
      product_code: order.product_code,
    },
  };
  const params: Record<string, string> = {
    app_key: cred?.api_key ?? "",
    method: cred?.extra?.method ?? "ec.order.create",
    format: "json",
    v: "1.0",
    sign_method: "md5",
    timestamp: ts,
    biz_data: JSON.stringify(bizData),
  };
  const sorted = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
  params.sign = (await md5(`${cred?.api_secret ?? ""}${sorted}${cred?.api_secret ?? ""}`)).toUpperCase();

  const res = await fetch(cfg.api_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let raw: any = text;
  try { raw = JSON.parse(text); } catch { /* keep text */ }

  const tracking =
    raw?.result?.tracking_no ?? raw?.data?.tracking_no ?? raw?.tracking_no ?? raw?.result?.waybill_no ?? null;
  const label = raw?.result?.label_url ?? raw?.data?.label_url ?? null;
  if (!res.ok || !tracking) {
    return { tracking_number: null, label_url: null, raw, error: raw?.msg ?? raw?.message ?? `HTTP ${res.status}` };
  }
  return { tracking_number: tracking, label_url: label, raw };
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
      Receiver: {
        CountryCode: order.shipping_country ?? "US",
        FirstName: order.recipient_name,
        Street: order.shipping_address ?? "",
        City: order.shipping_city ?? "",
        State: order.shipping_state ?? "",
        Zip: order.shipping_zip ?? "",
        Phone: order.recipient_phone ?? "",
      },
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

    const { shipment_id, carrier } = await req.json();
    if (!shipment_id || !carrier) return json({ error: "shipment_id and carrier required" }, 400);

    const { data: shipment, error: sErr } = await admin
      .from("shipments")
      .select("*")
      .eq("id", shipment_id)
      .maybeSingle();
    if (sErr || !shipment) return json({ error: "shipment not found" }, 404);
    if (shipment.tracking_number) {
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
