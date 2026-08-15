// 4PX open platform client (router/api/service).
//
// Spec (4PX 商家接入 / API标准接口-对接指引):
//   POST {api_url}?method=..&app_key=..&v=..&timestamp=..&format=json&sign=..
//   Content-Type: application/json ; body = business JSON
//   sign = md5(concat(sorted "key"+"value" of common params) + compact JSON body + app_secret)
//   access_token and language are transmitted but excluded from the signature.
import { md5 } from "./md5.ts";

export const FPX_PROD_URL = "https://open.4px.com/router/api/service";
export const FPX_TEST_URL = "https://open-test.4px.com/router/api/service";

export interface FpxCred {
  api_key?: string | null;
  api_secret?: string | null;
  account_no?: string | null;
  extra?: Record<string, unknown> | null;
}

export interface FpxResponse {
  ok: boolean;
  httpStatus: number;
  code: string | null;
  message: string | null;
  data: any;
  raw: any;
  authFailed: boolean;
}

export function fpxEndpoint(apiUrl?: string | null, apiMode?: string | null) {
  // Keep the mode selector authoritative for the two official 4PX hosts.
  // A previously saved production URL must not silently override test mode.
  if (apiUrl === FPX_PROD_URL || apiUrl === FPX_TEST_URL) {
    return apiMode === "test" ? FPX_TEST_URL : FPX_PROD_URL;
  }
  if (apiUrl && /^https?:\/\//i.test(apiUrl)) return apiUrl;
  return apiMode === "test" ? FPX_TEST_URL : FPX_PROD_URL;
}

export function fpxSign(params: Record<string, string>, body: string, secret: string) {
  const concat = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return md5(`${concat}${body}${secret}`);
}

export async function fpxCall(
  endpoint: string,
  cred: FpxCred,
  method: string,
  version: string,
  bizData: unknown,
  language = "en",
  timeoutMs = 55_000,
): Promise<FpxResponse> {
  const common: Record<string, string> = {
    method,
    app_key: (cred.api_key ?? "").trim(),
    v: version,
    format: "json",
    timestamp: Date.now().toString(),
  };
  const accessToken = (cred.extra as any)?.access_token;
  const body = JSON.stringify(bizData ?? {});

  // Official 4PX algorithm: sort the five base common parameters, append the
  // exact compact JSON body and then App Secret. access_token, language and sign
  // are not signed. Send one deterministic request; never guess variants.
  const secret = (cred.api_secret ?? "").trim();
  const sign = fpxSign(common, body, secret);
  const query = { ...common, ...(accessToken ? { access_token: String(accessToken).trim() } : {}), language, sign };
  const qs = new URLSearchParams(query);
  const res = await fetch(`${endpoint}?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let raw: any = text;
  try { raw = JSON.parse(text); } catch { /* keep text */ }


  const code = String(raw?.result ?? raw?.code ?? raw?.error_code ?? raw?.errorCode ?? "");
  const errList = Array.isArray(raw?.errors) ? raw.errors : [];
  const errText = errList
    .map((e: any) => [e?.error_code, e?.error_msg ?? e?.errorMsg].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
  const baseMsg = raw?.msg ?? raw?.message ?? raw?.error_msg ?? raw?.errorMsg ?? null;
  const message = [baseMsg, errText].filter(Boolean).join(" | ") || null;
  const data = raw?.data ?? raw?.result_data ?? null;

  // 4PX returns result=1 ("System processing succeeded") on success. Some legacy
  // endpoints answer with "0"/"S"/true. Failures always carry an errors[] payload.
  const success =
    res.ok && errList.length === 0 &&
    (code === "1" || code === "0" || code === "S" || code === "true" || raw?.success === true);
  const authFailed = /认证参数非法|签名|sign\s*error|invalid\s*sign|app_key|token|unauthorized/i.test(
    `${code} ${message ?? ""} ${typeof raw === "string" ? raw : ""}`,
  );


  return { ok: success, httpStatus: res.status, code: code || null, message, data, raw, authFailed };
}

/** Auth-only probe: lists logistics products. Valid credentials => success. */
export async function fpxProbe(endpoint: string, cred: FpxCred) {
  const r = await fpxCall(endpoint, cred, "ds.xms.logistics_product.getlist", "1.0.0", { transport_mode: "1" }, "en", 45_000);
  return {
    ok: r.ok || (!r.authFailed && r.httpStatus === 200),
    message: r.ok
      ? `4PX auth OK (HTTP ${r.httpStatus})`
      : `4PX: ${r.message ?? r.code ?? `HTTP ${r.httpStatus}`}`,
    raw: r.raw,
  };
}

/** Cancel an order created for testing on the production endpoint. */
export async function fpxCancelOrder(endpoint: string, cred: FpxCred, refNo: string, fpxTrackingNo?: string | null) {
  const reason = "Connectivity test order - cancelled automatically";
  const attempts: Array<{ method: string; v: string; biz: Record<string, unknown> }> = [
    { method: "ds.xms.order.cancel", v: "1.0.0", biz: { request_no: fpxTrackingNo ?? refNo, cancel_reason: reason } },
    { method: "ds.xms.order.cancel", v: "1.0.0", biz: { request_no: refNo, cancel_reason: reason } },
  ];

  const tried: unknown[] = [];
  for (const a of attempts) {
    try {
      const r = await fpxCall(endpoint, cred, a.method, a.v, a.biz, "en", 45_000);
      tried.push({ method: a.method, ok: r.ok, message: r.message, code: r.code });
      if (r.ok) return { ok: true, method: a.method, raw: r.raw, tried };
    } catch (e) {
      tried.push({ method: a.method, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: false, method: null, raw: null, tried };
}
