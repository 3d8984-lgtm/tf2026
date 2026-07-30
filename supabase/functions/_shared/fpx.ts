// 4PX open platform client (router/api/service).
//
// Spec (4PX 商家接入 / API标准接口-对接指引):
//   POST {api_url}?method=..&app_key=..&v=..&timestamp=..&format=json&sign=..
//   Content-Type: application/json ; body = business JSON
//   sign = md5(app_secret + concat(sorted "key"+"value" of common params) + app_secret)
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
  if (apiUrl && /^https?:\/\//i.test(apiUrl)) return apiUrl;
  return apiMode === "test" ? FPX_TEST_URL : FPX_PROD_URL;
}

export function fpxSign(params: Record<string, string>, secret: string) {
  const concat = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return md5(`${secret}${concat}${secret}`);
}

export async function fpxCall(
  endpoint: string,
  cred: FpxCred,
  method: string,
  version: string,
  bizData: unknown,
  language = "en",
  timeoutMs = 25_000,
): Promise<FpxResponse> {
  const common: Record<string, string> = {
    method,
    app_key: cred.api_key ?? "",
    v: version,
    format: "json",
    timestamp: Date.now().toString(),
  };
  const accessToken = (cred.extra as any)?.access_token;
  if (accessToken) common.access_token = String(accessToken);

  const sign = fpxSign(common, cred.api_secret ?? "");
  const qs = new URLSearchParams({ ...common, sign, language });

  const res = await fetch(`${endpoint}?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bizData ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let raw: any = text;
  try { raw = JSON.parse(text); } catch { /* keep text */ }

  const code = String(raw?.result ?? raw?.code ?? raw?.error_code ?? raw?.errorCode ?? "");
  const message = raw?.msg ?? raw?.message ?? raw?.error_msg ?? raw?.errorMsg ?? null;
  const data = raw?.data ?? raw?.result_data ?? null;
  // 4PX returns result/code "0" (or "S"/true) on success.
  const success = res.ok && (code === "0" || code === "S" || code === "true" || raw?.success === true);
  const authFailed = /认证参数非法|签名|sign\s*error|invalid\s*sign|app_key|token|unauthorized/i.test(
    `${code} ${message ?? ""} ${typeof raw === "string" ? raw : ""}`,
  );

  return { ok: success, httpStatus: res.status, code: code || null, message, data, raw, authFailed };
}

/** Auth-only probe: lists logistics products. Valid credentials => success. */
export async function fpxProbe(endpoint: string, cred: FpxCred) {
  const r = await fpxCall(endpoint, cred, "ds.xms.logistics_product.getlist", "1.0.0", { transport_mode: "1" }, "en", 15_000);
  return {
    ok: r.ok || (!r.authFailed && r.httpStatus === 200),
    message: r.ok
      ? `4PX auth OK (HTTP ${r.httpStatus})`
      : `4PX: ${r.message ?? r.code ?? `HTTP ${r.httpStatus}`}`,
    raw: r.raw,
  };
}
