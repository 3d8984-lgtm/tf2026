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

// ---- 4PX: ds.xms.label.get — 주문 생성 직후에는 라벨 PDF가 아직 준비되지 않는 경우가 있어
// 여러 파라미터 조합 × 재시도(지연)로 확실히 받아온다. 실패 시 null.
async function fetch4pxLabel(
  endpoint: string,
  cred: any,
  extra: Record<string, any>,
  attempts: Record<string, string>[],
  onRaw?: (raw: unknown) => void,
  rounds = 3,
): Promise<string | null> {
  const printPick = String(extra.is_print_pick_info ?? "Y").toUpperCase() === "N" ? "N" : "Y";
  for (let round = 0; round < rounds; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, 1500));
    for (const key of attempts) {
      try {
        const label = await fpxCall(endpoint, cred, "ds.xms.label.get", "1.1.0", {
          ...key,
          label_size: extra.label_size ?? "label_100x150",
          // 打印配货信息 (배송/피킹 정보 = SKU·품명 인쇄)
          is_print_pick_info: printPick,
          is_print_merge: "N",
        });
        onRaw?.(label.raw);
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
          return String(direct).replace(/^http:\/\/bss-fss\.4px\.com\//i, "https://bss-fss.4px.com/");
        }
        if (typeof b64 === "string" && b64.length > 100) {
          const clean = b64.replace(/\s/g, "");
          const decoded = base64LabelToDataUrl(clean);
          if (decoded) return decoded;
          const isHtml = /^(PCFE|PGh0|PGRp|PHN2)/.test(clean) || /^\s*</.test(b64);
          if (isHtml) return `data:text/html;base64,${clean}`;
          console.log("[4px label] base64 payload was not a valid PDF/PNG");
        }
      } catch { /* try the next parameter combination */ }
    }
  }
  return null;
}

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

  // SKU 칸에는 브랜드/품명을 넣지 않는다. 설정된 SKU 값이 있으면 그것을, 없으면 주문번호를 사용.
  const skuText = String(
    extra.sku ?? order.external_order_id ?? "",
  )
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32) || "TWINMETA";
  // declare_product_code 는 4PX 규격상 32자 이하여야 한다.
  const skuCode = skuText.slice(0, 32);
  const printPickInfo =
    String(extra.is_print_pick_info ?? "Y").toUpperCase() === "N" ? "N" : "Y";






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
        // 配货信息(피킹/배송 정보) 인쇄 시 라벨에 찍히는 상품 목록
        product_list: [
          {
            sku_code: skuCode,
            product_name: extra.item_name_en ?? "T-Shirt",
            product_description: extra.item_name_en ?? "T-Shirt",
            product_unit_price: unitPrice,
            currency: "USD",
            qty,
          },
        ],
        declare_product_info: [
          {
            // SKU 칸 — 주문번호(또는 설정된 SKU). 브랜드/품명은 넣지 않음.
            sku: skuCode,
            sku_code: skuCode,
            declare_product_code: skuCode,
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

    // 라벨 생성 옵션 — 주문 생성 시점에 지정해야 4PX가 해당 옵션으로 PDF를 만든다.
    // is_print_pick_info = 打印配货信息 (SKU·품명 등 배송정보 인쇄)
    label_config_info: {
      label_size: extra.label_size ?? "label_100x150",
      response_label_format: "PDF",
      create_logistics_label: "Y",
      logistics_label_config: {
        is_print_time: "N",
        is_print_buyer_id: "N",
        is_print_pick_info: printPickInfo,
      },
      create_package_label: "N",
    },
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
  labelUrl = await fetch4pxLabel(endpoint, cred, extra, attempts, (r) => { labelRaw = r; });
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


async function yunOpenApiSign(secret: string, canonical: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
  let binary = "";
  for (const byte of signed) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * YunExpress OpenAPI request signing.
 * canonical: [body=<exact JSON>&]date=<epoch ms>&method=<METHOD>&uri=<path>
 */
async function yunOpenApiFetch(
  url: string,
  method: "GET" | "POST",
  path: string,
  body: string | undefined,
  token: string,
  secret: string,
  timeoutMs: number,
): Promise<{ res: Response; text: string; raw: any }> {
  const date = String(Date.now());
  const canonical = `${body ? `body=${body}&` : ""}date=${date}&method=${method}&uri=${path}`;
  const sign = await yunOpenApiSign(secret, canonical);
  const res = await fetch(url, {
    method,
    headers: {
      token,
      date,
      sign,
      "Accept-Language": "zh-CN",
      Accept: "application/json",
      "Content-Type": "application/json;charset=utf-8",
    },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let raw: any = text;
  try { raw = JSON.parse(text); } catch { /* keep text */ }
  return { res, text, raw };
}

/** base64 -> bytes (tolerant of whitespace / url-safe alphabet / data: prefix). */
function b64ToBytes(input: string): Uint8Array | null {
  try {
    let s = input.trim();
    const comma = s.indexOf(",");
    if (s.startsWith("data:") && comma > 0) s = s.slice(comma + 1);
    s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (s.length % 4) s += "=".repeat(4 - (s.length % 4));
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Detects the real file type from the leading magic bytes. */
function sniffLabelType(buf: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(buf.slice(0, 512));
  if (/^%PDF/.test(head)) return "application/pdf";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (head.startsWith("GIF8")) return "image/gif";
  if (/^\s*(<!doctype html|<html|<\?xml|<svg)/i.test(head)) return "text/html";
  return null;
}

function bytesToDataUrl(buf: Uint8Array, ct: string): string {
  let binary = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return `data:${ct};base64,${btoa(binary)}`;
}

/**
 * Download a carrier label URL server-side and inline it as a data URL
 * (avoids CORS / expiring links). The MIME type is decided by the real bytes,
 * never by the carrier's content-type header — a JSON/HTML error page served as
 * "application/pdf" is what produced corrupted printouts.
 */
async function inlineLabelUrl(url: string, fallbackType = "application/pdf", timeoutMs = 25_000): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.log("[label download]", res.status, url.slice(0, 160));
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 1000) {
      console.log("[label download] too small", buf.byteLength, url.slice(0, 160));
      return null;
    }
    const sniffed = sniffLabelType(buf);
    if (!sniffed || sniffed === "text/html") {
      console.log("[label download] not a printable label", sniffed ?? "unknown",
        new TextDecoder("latin1").decode(buf.slice(0, 120)));
      return null;
    }
    const ct = sniffed ?? fallbackType;
    return bytesToDataUrl(buf, ct);
  } catch (e) {
    console.log("[yun label download error]", String(e));
    return null;
  }
}


/** Turns a carrier-supplied base64 payload into a validated data URL (null if not printable). */
function base64LabelToDataUrl(b64: string, fallbackType = "application/pdf"): string | null {
  const buf = b64ToBytes(b64);
  if (!buf || buf.byteLength < 800) return null;
  const sniffed = sniffLabelType(buf);
  if (!sniffed || sniffed === "text/html") {
    console.log("[label base64] not a printable label", sniffed ?? "unknown");
    return null;
  }
  return bytesToDataUrl(buf, sniffed ?? fallbackType);
}


/** YunExpress OpenAPI: waybill status probe (GET /v1/order/info/get). Returns the parsed result. */
async function fetchYunOpenApiInfo(root: string, token: string, secret: string, ref: string): Promise<any> {
  const path = "/v1/order/info/get";
  try {
    const { res, text, raw } = await yunOpenApiFetch(
      `${root}${path}?order_number=${encodeURIComponent(ref)}`,
      "GET", path, undefined, token, secret, 15_000,
    );
    console.log("[yun openapi info]", ref, res.status, String(text).slice(0, 300));
    return raw?.result ?? raw?.data ?? null;
  } catch (e) {
    console.log("[yun openapi info error]", ref, String(e));
    return null;
  }
}

/**
 * A real YunExpress waybill number is the carrier tracking code (YT…, LP…, UA… etc.).
 * The OpenAPI also returns an internal order number that is just a timestamp
 * (e.g. 20260823141846822) — that is NOT a waybill and must never be stored as one.
 */
function isYunTrackingNumber(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (s.length < 8) return false;
  return !/^\d{12,}$/.test(s);
}

/** Poll /v1/order/info/get until YunExpress allocates the real tracking number. */
async function waitForYunTracking(
  root: string,
  token: string,
  secret: string,
  refs: string[],
  attempts = 4,
): Promise<string | null> {
  const list = refs.filter(Boolean).map(String);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    for (const ref of list) {
      const info = await fetchYunOpenApiInfo(root, token, secret, ref);
      const candidate = [info?.tracking_number, info?.trackingNumber, info?.waybill_number, info?.waybillNumber]
        .find((v) => isYunTrackingNumber(v));
      if (candidate) return String(candidate).trim();
    }
  }
  return null;
}



/**
 * YunExpress OpenAPI (openapi.yunexpress.cn) label fetch:
 *   GET /v1/order/label/get?order_number=XXX
 *   headers: token, date(ms), sign = Base64(HMAC-SHA256(appSecret, canonical request))
 * Returns result.url (PDF/PNG, downloaded and inlined) or result.label_string (base64).
 * The label is not always ready immediately after order creation, so we retry.
 */
async function fetchYunOpenApiLabel(
  openapiBase: string,
  token: string,
  secret: string,
  refs: string[],
  attempts = 3,
): Promise<string | null> {
  const root = (openapiBase || "https://openapi.yunexpress.cn").replace(/\/+$/, "");
  const path = "/v1/order/label/get";
  const list = refs.filter(Boolean);
  let lastRef = "";
  // Every /v1/order/label/get call is recorded by YunExpress as a "打印订单" event,
  // so it must be requested as few times as possible: once we hold a label URL we
  // only re-download that URL instead of asking the carrier for the label again.
  let cachedUrl: string | null = null;
  let cachedType = "application/pdf";
  const deadline = Date.now() + 60_000;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    if (Date.now() > deadline) break;
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));

    // Retry path: reuse the URL we already obtained — no new carrier print event.
    if (cachedUrl) {
      const again = await inlineLabelUrl(cachedUrl, cachedType, 30_000);
      if (again) return again;
      continue;
    }

    for (const ref of list) {
      if (Date.now() > deadline) break;
      lastRef = ref;
      try {
        const q = `${root}${path}?order_number=${encodeURIComponent(ref)}`;
        const { res, text, raw } = await yunOpenApiFetch(q, "GET", path, undefined, token, secret, 12_000);

        const r = raw?.result ?? raw?.data ?? {};
        const type = String(r?.label_type ?? r?.labelType ?? "PDF").toUpperCase() === "PNG"
          ? "image/png"
          : "application/pdf";
        const url = [r?.url, r?.label_url, r?.labelUrl, r?.file_url, r?.fileUrl]
          .find((v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v)) as string | undefined;
        const b64 = [r?.label_string, r?.labelString, r?.label_content, r?.content]
          .find((v: unknown) => typeof v === "string" && v.length > 500) as string | undefined;

        if (raw?.success !== false && url) {
          cachedUrl = url;
          cachedType = type;
          const inlined = await inlineLabelUrl(url, type, 30_000);
          if (inlined) return inlined;
          // URL is valid but the CDN was slow — stop asking the carrier for more labels.
          break;
        }
        if (raw?.success !== false && b64) {
          const decoded = base64LabelToDataUrl(b64, type);
          if (decoded) return decoded;
          console.log("[yun openapi label] base64 payload was not a valid PDF/PNG", ref);
        }
        console.log("[yun openapi label]", ref, `try${attempt + 1}`, res.status, String(text).slice(0, 300));
      } catch (e) {
        console.log("[yun openapi label error]", ref, String(e));
      }
    }
  }
  if (!cachedUrl && lastRef) await fetchYunOpenApiInfo(root, token, secret, lastRef);
  return null;
}



/** YunExpress: fetch the shipping label PDF for an already-created waybill. */
async function fetchYunLabel(base: string, auth: string, refs: string[], openapi?: { base?: string; token?: string; secret?: string }): Promise<string | null> {
  const root = (base ?? "").replace(/\/+$/, "");
  const clean = refs.filter(Boolean);
  if (!clean.length) return null;
  if (openapi?.token) {
    const viaOpenApi = await fetchYunOpenApiLabel(openapi.base ?? "", openapi.token, openapi.secret ?? "", clean);
    if (viaOpenApi) return viaOpenApi;
  }
  if (!root) return null;


  const pick = (raw: any): string | null => {
    if (!raw) return null;
    if (typeof raw === "string") {
      if (/^https?:\/\//i.test(raw.trim())) return raw.trim();
      if (raw.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(raw.trim())) return base64LabelToDataUrl(raw);
      return null;
    }
    if (Array.isArray(raw)) { for (const r of raw) { const v = pick(r); if (v) return v; } return null; }
    if (typeof raw === "object") {
      for (const k of ["LabelUrl", "labelUrl", "Url", "url", "PdfUrl", "ShippingLabelUrl", "LabelContent", "Content", "Base64", "Data", "Item"]) {
        if (k in raw) { const v = pick((raw as any)[k]); if (v) return v; }
      }
    }
    return null;
  };

  for (const ref of clean) {
    const candidates: { url: string; method: "GET" | "POST"; body?: string }[] = [
      { url: `${root}/api/WayBill/GetLabels?OrderNumber=${encodeURIComponent(ref)}`, method: "GET" },
      { url: `${root}/api/Label/GetLabel?OrderNumber=${encodeURIComponent(ref)}&Format=PDF`, method: "GET" },
      { url: `${root}/api/WayBill/GetLabel?OrderNumber=${encodeURIComponent(ref)}`, method: "GET" },
      { url: `${root}/api/Label/GetLabels`, method: "POST", body: JSON.stringify([ref]) },
    ];
    for (const c of candidates) {
      try {
        const res = await fetch(c.url, {
          method: c.method,
          headers: { Authorization: `Basic ${auth}`, Accept: "application/json,application/pdf", "Content-Type": "application/json" },
          body: c.body,
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) continue;
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("pdf") || ct.includes("octet-stream") || ct.includes("image/")) {
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.byteLength < 800) continue;
          const sniffed = sniffLabelType(buf);
          if (!sniffed || sniffed === "text/html") continue;
          return bytesToDataUrl(buf, sniffed);
        }
        const text = await res.text();
        let raw: any = text;
        try { raw = JSON.parse(text); } catch { /* keep text */ }
        const found = pick(raw);
        if (found) return found.startsWith("data:") ? found : (await inlineLabelUrl(found)) ?? found;
      } catch { /* try the next candidate */ }

    }
  }
  return null;
}



/** YunExpress 신버전 OpenAPI 오류코드 → 사람이 읽는 메시지 */
function yunOpenApiErrorText(code?: string, msg?: string): string {
  const map: Record<string, string> = {
    "0200401002": "YunExpress OpenAPI 인증 토큰이 유효하지 않거나 만료되었습니다. 샌드박스 승인 AppId는 테스트 모드(openapi-sbx), 운영 승인 AppId는 실서비스 모드(openapi)에 맞춰 사용하고 인증정보를 다시 저장해 주세요.",
    "0200401101": "YunExpress OpenAPI 접근 서명(sign)이 누락/불일치입니다. AppSecret(密钥)이 정확한지, 환경(샌드박스/운영)이 일치하는지 확인해 주세요.",
    "0200401102": "YunExpress OpenAPI 서명/토큰이 무효하거나 만료되었습니다. AppId·AppSecret·SourceKey가 해당 환경(샌드박스/운영)과 일치하는지 확인해 주세요.",

    "02039311": "YunExpress 계정 잔액 부족 — 충전 후 다시 발행하세요.",
    "02039015": "동일 주문이 처리 중입니다. 잠시 후 다시 시도하세요.",
    "02039066": "이미 등록된 주문번호입니다(중복). 초기화 후 재발행하세요.",
    "02039067": "이미 등록된 트래킹번호입니다(중복).",
    "02039019": "선택한 물류상품(product_code)이 존재하지 않거나 사용할 수 없습니다.",
    "02039083": "목적지 주소(우편번호) 미배송 지역이거나 중량이 지원되지 않습니다.",
    "02039026": "수취인 정보가 누락되었습니다.",
    "02039039": "수취인 정보에 특수문자가 포함되어 있습니다.",
    "02030010": "수취인 우편번호는 영문/숫자/공백만 허용됩니다.",
    "02039306": "중량은 0보다 커야 하며 소수점 3자리까지만 허용됩니다.",
  };
  return map[String(code ?? "")] ?? (msg ? `${msg}${code ? ` (${code})` : ""}` : `YunExpress 오류 ${code ?? ""}`);
}

function yunOpenApiBase(cfg: any, cred: any): string {
  const configured = String(cred?.extra?.openapi_url ?? "").trim();
  if (configured) return configured;
  return String(cfg?.api_mode ?? "test").toLowerCase() === "live"
    ? "https://openapi.yunexpress.cn"
    : "https://openapi-sbx.yunexpress.cn";
}

function yunOpenApiSecret(cred: any): string {
  return String(
    Deno.env.get("YUNEXPRESS_OPENAPI_APP_SECRET") ??
    cred?.extra?.openapi_app_secret ??
    cred?.extra?.openapi_secret ??
    cred?.extra?.secret ??
    "",
  ).trim();
}

/** OAuth2 access token cache (per base + appId), refreshed a minute before expiry. */
const yunTokenCache = new Map<string, { token: string; exp: number }>();

/**
 * YunExpress OAuth2 (client_credentials)
 *   POST {base}/openapi/oauth2/token
 *   { grantType, appId, appSecret, sourceKey } → { accessToken, expiresIn }
 * 수동 입력된 access token이 있으면 그 값을 그대로 사용한다.
 */
async function yunAccessToken(cfg: any, cred: any): Promise<string | undefined> {
  const e = (cred?.extra ?? {}) as Record<string, any>;
  const manual = String(e.openapi_access_token ?? "").trim();
  if (manual) return manual;

  const appId = String(Deno.env.get("YUNEXPRESS_OPENAPI_APP_ID") ?? e.openapi_app_id ?? e.openapi_token ?? e.token ?? "").trim();
  const appSecret = yunOpenApiSecret(cred);
  const sourceKey = String(Deno.env.get("YUNEXPRESS_OPENAPI_SOURCE_KEY") ?? e.openapi_source_key ?? e.source_key ?? e.sourcekey ?? "").trim();
  if (!appId || !appSecret) return undefined;

  const base = yunOpenApiBase(cfg, cred).replace(/\/+$/, "");
  const key = `${base}|${appId}`;
  const hit = yunTokenCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.token;

  try {
    const res = await fetch(`${base}/openapi/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8", Accept: "application/json" },
      body: JSON.stringify({ grantType: "client_credentials", appId, appSecret, sourceKey }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let raw: any = text;
    try { raw = JSON.parse(text); } catch { /* keep text */ }
    const node = raw?.accessToken ? raw : (raw?.data ?? raw?.result ?? {});
    const token = String(node?.accessToken ?? node?.access_token ?? "").trim();
    if (!token) {
      console.log("[yun oauth2 token error]", res.status, String(raw?.code ?? ""), String(raw?.message ?? raw?.msg ?? "token missing").slice(0, 160));
      return undefined;
    }
    console.log("[yun oauth2 token]", res.status, "issued");
    const ttl = Number(node?.expiresIn ?? node?.expires_in ?? 7200);
    yunTokenCache.set(key, { token, exp: Date.now() + Math.max(60, ttl - 60) * 1000 });
    return token;
  } catch (err) {
    console.log("[yun oauth2 token error]", String(err));
    return undefined;
  }
}


/**
 * YunExpress 신버전 OpenAPI 단표 주문 생성
 *   POST /v1/order/package/create
 *   headers: token, date(ms), sign = Base64(HMAC-SHA256(appSecret, canonical request))
 */
async function createYunOpenApiOrder(
  openapi: { base?: string; token: string; secret: string },
  cred: any,
  order: any,
  shipment: any,
  position?: number,
  qty = 1,
): Promise<LabelResult | null> {
  const root = (openapi.base || "https://openapi.yunexpress.cn").replace(/\/+$/, "");
  const path = "/v1/order/package/create";
  const src = shippingRecipient(order, position);
  const r = normalizeRecipient(src);
  const weightKg = Math.max(0.001, Math.round(((((shipment.weight_grams ?? shipment.expected_weight_grams ?? 0) / 1000) || 0.1) * qty) * 1000) / 1000);
  const unitPrice = Number(cred?.extra?.unit_price ?? 10);
  const ex = (cred?.extra ?? {}) as Record<string, unknown>;
  const s = (...keys: string[]) => {
    for (const k of keys) {
      const v = ex[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };
  // 시스템 설정에 저장되는 키(hscode)와 OpenAPI 필드명(hs_code)이 달라 신고정보가 비어 있던 문제 수정
  const hsCode = s("hs_code", "hscode");
  const brand = s("brand");
  const material = s("material");
  const usage = s("usage", "purpose");
  const model = s("model");
  const spec = s("spec", "specification");
  const weave = s("weaving_mode", "weave");
  const nameEn = s("item_name_en") || "T-Shirt";
  const nameCn = s("item_name_cn") || "T恤";
  const sku = s("sku") || String(order.product_code ?? order.external_order_id ?? "").slice(0, 32);

  const declaration: Record<string, unknown> = {
    name_en: nameEn,
    name_local: nameCn,
    quantity: qty,
    unit_price: unitPrice,
    unit_weight: Math.max(0.001, Math.round((weightKg / qty) * 1000) / 1000),
    currency: "USD",
  };
  if (hsCode) declaration.hs_code = hsCode;
  if (sku) declaration.sku = sku;
  if (brand) { declaration.brand = brand; declaration.brand_name = brand; }
  if (material) { declaration.material = material; declaration.texture = material; }
  if (usage) { declaration.usage = usage; declaration.purpose = usage; }
  if (model) { declaration.model = model; declaration.model_number = model; }
  if (spec) { declaration.spec = spec; declaration.specification = spec; }
  if (weave) { declaration.weaving_mode = weave; declaration.weave_method = weave; }

  // 발신자(发件人) 정보 — 공식 문서(2026-07-21) 기준 스펙 필드만 전송한다.
  // 문서상 sender 는 "非必须"이며, 누락/검증 실패 시 계정의 公共发件人(공용 발신인)로 대체되어
  // 관리자 페이지에 우리가 보낸 발신자가 표시되지 않는다 (에러 02039160/02039161 참조).
  // 빈 문자열/undefined 필드가 섞이면 sender 블록 전체가 무시될 수 있으므로 값 있는 필드만 포함.
  const senderName = s("sender_name") || "TWINMETA";
  const senderParts = senderName.split(/\s+/);
  const senderStreet = s("sender_street") || "-";
  const senderZip = s("sender_post_code", "sender_zip") || "518000";
  const senderPhone = s("sender_phone") || "13000000000";
  const senderCompany = s("sender_company") || senderName;
  const sender: Record<string, unknown> = {
    first_name: senderParts[0] ?? senderName,
    last_name: senderParts.slice(1).join(" ") || senderParts[0] || senderName,
    company: senderCompany,
    country_code: s("sender_country") || "CN",
    province: s("sender_state") || "GuangDong",
    city: s("sender_city") || "Shenzhen",
    address_lines: [senderStreet],
    postal_code: senderZip,
    phone_number: senderPhone,
  };
  const senderEmail = s("sender_email");
  if (senderEmail) sender.email = senderEmail;
  const senderCertType = s("sender_certificate_type");
  const senderCertCode = s("sender_certificate_code", "sender_usci", "usci");
  if (senderCertType && senderCertCode) {
    sender.certificate_type = senderCertType;
    sender.certificate_code = senderCertCode;
  }

  const payload = {
    product_code: cred?.extra?.openapi_product_code ?? cred?.extra?.channel_code ?? "",
    customer_order_number: String(order.external_order_id ?? "").slice(0, 50),
    weight_unit: "KG",
    size_unit: "CM",
    label_type: "PDF",
    sensitive_type: "W",
    packages: [{ weight: weightKg, length: Number(cred?.extra?.length_cm ?? 25), width: Number(cred?.extra?.width_cm ?? 20), height: Number(cred?.extra?.height_cm ?? 3) }],
    sender,
    receiver: {
      first_name: r.first_name,
      last_name: r.last_name,
      company: "",
      country_code: r.country,
      province: r.state,
      city: r.city,
      address_lines: [r.street].filter(Boolean),
      postal_code: r.zip,
      phone_number: src.recipient_phone ?? "",
      email: src.recipient_email ?? "",
    },
    declaration_info: [declaration],
    // 시스템 설정 > 택배사 연동 > YunExpress 의 "비고(Remark)" 값
    ...(s("remark") ? { remark: s("remark") } : {}),
  };
  const body = JSON.stringify(payload);
  console.log("[yun openapi declaration]", JSON.stringify(declaration));
  console.log("[yun openapi request]", body.slice(0, 2000));




  const customerOrderNo = String(JSON.parse(body).customer_order_number ?? "");

  try {
    let raw: any = null;
    // 02030012 = "服务执行超时" (upstream timeout). 접수가 실제로 되었을 수도 있으므로
    // 먼저 주문 조회로 중복 접수를 막고, 미접수일 때만 재시도한다.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
      let call: Awaited<ReturnType<typeof yunOpenApiFetch>> | null = null;
      try {
        call = await yunOpenApiFetch(`${root}${path}`, "POST", path, body, openapi.token, openapi.secret ?? "", 30_000);
      } catch (networkError) {
        console.log("[yun openapi create network error]", `attempt=${attempt + 1}`, String(networkError));
        // A timed-out request may still have reached YunExpress. Query first,
        // then retry only when no accepted order is visible.
        if (customerOrderNo) {
          const info = await fetchYunOpenApiInfo(root, openapi.token, openapi.secret ?? "", customerOrderNo);
          if (info) {
            raw = { success: true, result: info };
            break;
          }
        }
        continue;
      }
      raw = call.raw;
      console.log("[yun openapi create]", call.res.status, `attempt=${attempt + 1}`, String(call.text).slice(0, 400));

      if (!raw || typeof raw !== "object") continue;
      if (raw.success) break;
      // 인증 자체가 거부되면(권한 미개통 등) 구버전 경로로 폴백한다.
      if (!raw.code) return null;

      const timedOut = String(raw.code) === "02030012" || /超时|timeout/i.test(String(raw.msg ?? raw.message ?? ""));
      if (!timedOut) {
        return { tracking_number: null, label_url: null, raw, error: yunOpenApiErrorText(raw.code, raw.msg ?? raw.message) };
      }
      // 타임아웃이어도 실제로 접수됐는지 확인
      if (customerOrderNo) {
        const info = await fetchYunOpenApiInfo(root, openapi.token, openapi.secret ?? "", customerOrderNo);
        if (info) {
          raw = { success: true, result: info };
          break;
        }
      }
    }

    if (!raw?.success) {
      return {
        tracking_number: null,
        label_url: null,
        raw,
        error: yunOpenApiErrorText(raw?.code, raw?.msg ?? raw?.message) +
          " — YunExpress 서버 응답 지연(타임아웃)으로 3회 재시도했습니다. 잠시 후 다시 시도하세요.",
      };
    }

    const result = raw.result ?? {};
    // YunExpress는 접수 직후 내부 주문번호(타임스탬프 형태 2026...)만 돌려주고
    // 실제 운송장번호(YT...)는 조금 늦게 배정되는 경우가 있다. 내부 주문번호를
    // 운송장번호로 저장하면 4PX 송장처럼 보이는 숫자 번호가 찍히므로 금지한다.
    const customerOrderNoFromResult = String(result.customer_order_number ?? customerOrderNo ?? "").trim() || null;
    const carrierOrderNo = String(result.order_number ?? result.waybill_number ?? "").trim() || null;
    let tracking = [result.tracking_number, result.waybill_number].find((v: unknown) => isYunTrackingNumber(v)) ?? null;
    if (!tracking) {
      tracking = await waitForYunTracking(
        root,
        openapi.token,
        openapi.secret ?? "",
        [customerOrderNoFromResult, carrierOrderNo].filter(Boolean) as string[],
      );
    }
    if (!tracking) {
      return {
        tracking_number: null,
        label_url: null,
        raw,
        ref_no: customerOrderNoFromResult,
        error: raw.msg ?? "YunExpress 접수는 되었으나 운송장번호(YT…)가 아직 배정되지 않았습니다. 잠시 후 재시도하세요.",
      };
    }
    const label = await fetchYunOpenApiLabel(
      root,
      openapi.token,
      openapi.secret ?? "",
      [customerOrderNoFromResult, carrierOrderNo, tracking].filter(Boolean) as string[],
    );
    return { tracking_number: String(tracking), label_url: label, raw, ref_no: customerOrderNoFromResult };

  } catch (e) {
    console.log("[yun openapi create error]", String(e));
    // Do not fall through to the legacy CreateOrder endpoint after an OpenAPI
    // network timeout: the order may already have been accepted upstream.
    return {
      tracking_number: null,
      label_url: null,
      raw: null,
      error: `YunExpress OpenAPI 연결이 지연되었습니다. 중복 등록 방지를 위해 구버전 API로 재접수하지 않았습니다. 잠시 후 다시 시도하세요. (${e instanceof Error ? e.message : String(e)})`,
      ref_no: customerOrderNo,
    };
  }
}

async function callYunExpress(cfg: any, cred: any, order: any, shipment: any, position?: number, qtyOverride?: number): Promise<LabelResult> {
  const qty = Math.max(1, Number(qtyOverride ?? 1));
  const base = (cfg.api_url ?? "").replace(/\/+$/, "");
  const url = `${base}/api/WayBill/CreateOrder`;
  const auth = btoa(`${cred?.account_no ?? ""}&${cred?.api_key ?? ""}`);

  // 신버전 OpenAPI 자격증명이 있으면 우선 사용 (라벨 PDF까지 한 번에 확보)
  const oaToken = await yunAccessToken(cfg, cred);
  const oaSecret = yunOpenApiSecret(cred);
  if (oaToken && oaSecret) {
    const viaOpenApi = await createYunOpenApiOrder(
      { base: yunOpenApiBase(cfg, cred), token: oaToken, secret: oaSecret },
      cred, order, shipment, position, qty,
    );
    if (viaOpenApi) return viaOpenApi;
  }

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
      Sender: {
        CompanyName: cred?.extra?.sender_company ?? cred?.extra?.sender_name ?? "TWINMETA",
        FirstName: cred?.extra?.sender_name ?? "TWINMETA",
        LastName: cred?.extra?.sender_name ?? "TWINMETA",
        CountryCode: cred?.extra?.sender_country ?? "CN",
        State: cred?.extra?.sender_state ?? "GuangDong",
        City: cred?.extra?.sender_city ?? "Shenzhen",
        Street: cred?.extra?.sender_street ?? "-",
        Zip: cred?.extra?.sender_post_code ?? cred?.extra?.sender_zip ?? "518000",
        Phone: cred?.extra?.sender_phone ?? "13000000000",
        Email: cred?.extra?.sender_email ?? "",
      },


      Parcels: [
        {
          EName: cred?.extra?.item_name_en ?? "T-Shirt",
          CName: cred?.extra?.item_name_cn ?? "T恤",
          Quantity: qty,
          UnitPrice: Number(cred?.extra?.unit_price ?? 10),
          UnitWeight: 0.2,
          Currency: "USD",
          HSCode: cred?.extra?.hs_code ?? cred?.extra?.hscode ?? "",
          Brand: cred?.extra?.brand ?? "",
          Material: cred?.extra?.material ?? "",
          Usage: cred?.extra?.usage ?? "",
          Model: cred?.extra?.model ?? "",
          Spec: cred?.extra?.spec ?? "",

        },
      ],
      ...(String(cred?.extra?.remark ?? "").trim()
        ? { Remark: String(cred.extra.remark).trim() }
        : {}),
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
  const tracking = [item?.TrackingNumber, item?.WayBillNumber, raw?.TrackingNumber]
    .find((v: unknown) => isYunTrackingNumber(v)) ?? null;

  let label = item?.LabelUrl ?? item?.ShippingLabelUrl ?? null;
  if (!res.ok || !tracking) {
    return {
      tracking_number: null,
      label_url: null,
      raw,
      error: item?.Message ?? raw?.ResultDesc ?? raw?.Message ?? `HTTP ${res.status}`,
    };
  }
  // 구버전 응답에 라벨 URL이 없으면 신버전 OpenAPI 라벨 조회를 시도한다.
  if (!label && tracking) {
    try {
      label = await fetchYunLabel(
        base,
        btoa(`${cred?.account_no ?? ""}&${cred?.api_key ?? ""}`),
        [tracking].filter(Boolean) as string[],
        {
           base: yunOpenApiBase(cfg, cred),
          token: await yunAccessToken(cfg, cred),
          secret: yunOpenApiSecret(cred),
        },
      );
    } catch { /* ignore — status below reflects the outcome */ }
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

      // YunExpress: 접수 직후 내부 주문번호(숫자만)만 저장된 경우 실제 운송장번호(YT…)로 승격한다.
      if (g.tracking_number && (g.carrier ?? carrier) === "yunexpress" && !isYunTrackingNumber(g.tracking_number)) {
        const { data: cfgU } = await admin.from("courier_configs").select("*").eq("code", "yunexpress").maybeSingle();
        const { data: credU } = await admin.from("courier_credentials").select("*").eq("code", "yunexpress").maybeSingle();
        if (cfgU && credU) {
          const upgraded = await waitForYunTracking(
            (yunOpenApiBase(cfgU, credU) || "https://openapi.yunexpress.cn").replace(/\/+$/, ""),
            (await yunAccessToken(cfgU, credU)) ?? "",
            yunOpenApiSecret(credU),
            [g.tracking_number, g.ref_no].filter(Boolean) as string[],
            2,
          );
          if (upgraded) {
            g.ref_no = g.ref_no ?? g.tracking_number;
            g.tracking_number = upgraded;
            await admin.from("shipping_groups")
              .update({ tracking_number: upgraded, ref_no: g.ref_no })
              .eq("id", g.id);
            await admin.from("shipment_scan_items")
              .update({ tracking_number: upgraded })
              .eq("shipping_group_id", g.id);
          }
        }
      }

      // YunExpress: 주문(운송장)은 이미 만들어졌는데 라벨 PDF만 못 받은 경우 —
      // 절대로 주문을 다시 만들지 않고 라벨만 재요청한다 (중복 접수 방지).
      if (g.tracking_number && !g.label_url && (g.carrier ?? carrier) === "yunexpress") {
        const { data: cfgY } = await admin.from("courier_configs").select("*").eq("code", "yunexpress").maybeSingle();
        const { data: credY } = await admin.from("courier_credentials").select("*").eq("code", "yunexpress").maybeSingle();
        const { data: linkedItem } = await admin
          .from("shipment_scan_items")
          .select("order_id")
          .eq("shipping_group_id", g.id)
          .limit(1)
          .maybeSingle();
        const { data: linkedOrder } = linkedItem?.order_id
          ? await admin.from("orders").select("external_order_id").eq("id", linkedItem.order_id).maybeSingle()
          : { data: null };
        const syntheticCustomerOrderNo = linkedOrder?.external_order_id
          ? `${linkedOrder.external_order_id}-G${String(g.id).slice(0, 8)}`
          : null;
        const issuedAt = new Date().toISOString();
        let recovered: string | null = null;
        if (cfgY && credY) {
          recovered = await fetchYunLabel(
            cfgY.api_url ?? "",
            btoa(`${credY.account_no ?? ""}&${credY.api_key ?? ""}`),
            [g.ref_no, syntheticCustomerOrderNo, g.tracking_number].filter(Boolean) as string[],
            {
              base: yunOpenApiBase(cfgY, credY),
              token: await yunAccessToken(cfgY, credY),
              secret: yunOpenApiSecret(credY),
            },
          );
        }
        await admin.from("shipping_groups").update({
          carrier: "yunexpress",
          label_url: recovered,
          ref_no: g.ref_no ?? syntheticCustomerOrderNo,
          // 운송장번호가 있으면 접수는 성공한 것 → 실패로 표시하지 않는다.
          label_status: "ready",
          label_error: recovered ? null : "운송장은 발급됨 · 라벨 PDF 미수신 (재시도 시 라벨만 다시 요청)",
          label_issued_at: g.label_issued_at ?? issuedAt,
        }).eq("id", g.id);
        await admin.from("shipment_scan_items").update({
          carrier: "yunexpress",
          tracking_number: g.tracking_number,
          label_url: recovered,
          tracking_issued_at: issuedAt,
        }).eq("shipping_group_id", g.id);
        return json({ ok: true, recovered: !!recovered, carrier: "yunexpress", tracking_number: g.tracking_number, label_url: recovered });
      }


      // 이미 4PX 주문/운송장은 만들어졌는데 라벨 PDF만 못 받은 경우:
      // 주문을 다시 만들지 말고 ds.xms.label.get 만 재시도해서 복구한다.

      if (g.tracking_number && !g.label_url && (g.carrier ?? carrier) === "4px") {
        const { data: cfg0 } = await admin.from("courier_configs").select("*").eq("code", "4px").maybeSingle();
        const { data: cred0 } = await admin.from("courier_credentials").select("*").eq("code", "4px").maybeSingle();
        if (cfg0 && cred0) {
          const ep = fpxEndpoint(cfg0.api_url, cfg0.api_mode ?? "prod");
          const ex = (cred0.extra ?? {}) as Record<string, any>;
          const recovered = await fetch4pxLabel(
            ep,
            cred0,
            ex,
            [
              { request_no: g.tracking_number },
              ...(g.ref_no ? [{ request_no: g.ref_no, ref_no: g.ref_no }] : []),
            ],
          );
          if (recovered) {
            const issuedAt = new Date().toISOString();
            await admin.from("shipping_groups").update({
              label_url: recovered,
              label_status: "ready",
              label_error: null,
              label_issued_at: g.label_issued_at ?? issuedAt,
            }).eq("id", g.id);
            await admin.from("shipment_scan_items").update({
              carrier: g.carrier ?? carrier,
              tracking_number: g.tracking_number,
              label_url: recovered,
              tracking_issued_at: issuedAt,
            }).eq("shipping_group_id", g.id);
            return json({ ok: true, recovered: true, tracking_number: g.tracking_number, label_url: recovered, carrier: g.carrier ?? carrier });
          }
          await admin.from("shipping_groups").update({
            label_status: "failed",
            label_error: "4PX 라벨 PDF(ds.xms.label.get)를 받지 못했습니다. 잠시 후 재시도해 주세요.",
          }).eq("id", g.id);
          return json({ error: "4PX label PDF was not returned (tracking exists, retry later)", tracking_number: g.tracking_number }, 502);
        }
      }
      if (g.tracking_number && g.label_url && g.label_status === "ready") {
        if (g.carrier && g.carrier !== carrier) {
          return json({
            error: `이미 ${String(g.carrier).toUpperCase()} 송장(${g.tracking_number})이 발급된 그룹입니다. 초기화 후 ${String(carrier).toUpperCase()}로 다시 발행하세요.`,
            tracking_number: g.tracking_number,
            carrier: g.carrier,
          }, 409);
        }
        return json({ ok: true, already: true, tracking_number: g.tracking_number, label_url: g.label_url, carrier: g.carrier });
      }

      // YunExpress: 접수 요청 도중 함수가 타임아웃되면 그룹은 "발급중"으로 남지만
      // 택배사에는 주문이 실제로 등록되어 있을 수 있다. 새로 만들기 전에
      // 결정적 고객주문번호로 조회해서 이미 있으면 그대로 복구한다 (중복 접수 방지).
      if (!g.tracking_number && carrier === "yunexpress") {
        const { data: cfgP } = await admin.from("courier_configs").select("*").eq("code", "yunexpress").maybeSingle();
        const { data: credP } = await admin.from("courier_credentials").select("*").eq("code", "yunexpress").maybeSingle();
        const { data: itemP } = await admin
          .from("shipment_scan_items").select("order_id").eq("shipping_group_id", g.id).limit(1).maybeSingle();
        const { data: orderP } = itemP?.order_id
          ? await admin.from("orders").select("external_order_id").eq("id", itemP.order_id).maybeSingle()
          : { data: null };
        const probeRef = orderP?.external_order_id
          ? `${orderP.external_order_id}-G${String(g.id).slice(0, 8)}`
          : null;
        if (cfgP && credP && probeRef) {
          const rootP = (yunOpenApiBase(cfgP, credP) || "https://openapi.yunexpress.cn").replace(/\/+$/, "");
          const tokenP = (await yunAccessToken(cfgP, credP)) ?? "";
          const existing = tokenP
            ? await waitForYunTracking(rootP, tokenP, yunOpenApiSecret(credP), [probeRef, g.ref_no].filter(Boolean) as string[], 1)
            : null;
          if (existing) {
            const label = await fetchYunOpenApiLabel(rootP, tokenP, yunOpenApiSecret(credP), [probeRef, existing]);
            const issuedAt = new Date().toISOString();
            await admin.from("shipping_groups").update({
              carrier: "yunexpress",
              tracking_number: existing,
              ref_no: g.ref_no ?? probeRef,
              label_url: label,
              label_status: "ready",
              label_error: label ? null : "운송장은 발급됨 · 라벨 PDF 미수신 (재시도 시 라벨만 다시 요청)",
              label_issued_at: g.label_issued_at ?? issuedAt,
            }).eq("id", g.id);
            await admin.from("shipment_scan_items").update({
              carrier: "yunexpress",
              tracking_number: existing,
              label_url: label,
              tracking_issued_at: issuedAt,
            }).eq("shipping_group_id", g.id);
            return json({ ok: true, recovered: true, carrier: "yunexpress", tracking_number: existing, label_url: label });
          }
        }
      }

      // Idempotent claim: only one caller may flip pending/failed -> issuing.
      // "issuing" 상태가 90초 넘게 방치된 건은 이전 호출이 타임아웃된 것이므로 다시 가져온다.
      const staleCutoff = new Date(Date.now() - 90_000).toISOString();
      const claimable = ["pending", "failed"];
      if (g.label_status === "issuing" && String(g.updated_at ?? "") < staleCutoff) claimable.push("issuing");
      const { data: claimed } = await admin
        .from("shipping_groups")
        .update({ label_status: "issuing", label_error: null })
        .eq("id", g.id)
        .in("label_status", claimable)
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

    // 운송장번호는 받았는데 라벨 PDF만 비어서 온 경우: 주문 재생성 없이 라벨만 즉시 재요청.
    if (!result.label_url && carrier === "4px" && result.tracking_number) {
      try {
        const { data: cfgR } = await admin.from("courier_configs").select("*").eq("code", "4px").maybeSingle();
        const { data: credR } = await admin.from("courier_credentials").select("*").eq("code", "4px").maybeSingle();
        if (cfgR && credR) {
          const recovered = await fetch4pxLabel(
            fpxEndpoint(cfgR.api_url, cfgR.api_mode ?? "prod"),
            credR,
            (credR.extra ?? {}) as Record<string, any>,
            [
              { request_no: result.tracking_number },
              ...(result.ref_no ? [{ request_no: result.ref_no, ref_no: result.ref_no }] : []),
            ],
          );
          if (recovered) result.label_url = recovered;
        }
      } catch { /* keep going — status below reflects the outcome */ }
    }

    // YunExpress도 동일: 운송장번호만 오고 라벨이 비면 라벨만 재요청.
    if (!result.label_url && carrier === "yunexpress" && result.tracking_number) {
      try {
        result.label_url = await fetchYunLabel(
          cfg.api_url ?? "",
          btoa(`${cred?.account_no ?? ""}&${cred?.api_key ?? ""}`),
          [result.tracking_number, result.ref_no].filter(Boolean) as string[],
          {
             base: yunOpenApiBase(cfg, cred),
            token: await yunAccessToken(cfg, cred),
            secret: yunOpenApiSecret(cred),
          },
        );
      } catch { /* status below reflects the outcome */ }
    }

    if (group) {

      const { error: gErr } = await admin
        .from("shipping_groups")
        .update({
          carrier,
          tracking_number: result.tracking_number,
          label_url: result.label_url,
          ref_no: result.ref_no ?? null,
          // 운송장번호가 발급되면 접수는 성공 → ready. 라벨 PDF만 없으면 안내 문구만 남기고
          // 재시도 시 주문을 다시 만들지 않고 라벨만 다시 받아온다.
          label_status: "ready",
          label_error: result.label_url
            ? null
            : "운송장은 발급됨 · 라벨 PDF 미수신 (재시도 시 라벨만 다시 요청)",
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
