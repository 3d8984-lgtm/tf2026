import { supabase } from "@/integrations/supabase/client";

export const CCTV_PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * 게이트웨이가 발급한 읽기 전용(GET) 공개 키. 조회 요청은 엣지 프록시를
 * 거치지 않고 브라우저에서 직접 호출해 Edge Runtime 부하(503)를 없앤다.
 * 쓰기(POST/PATCH/DELETE)는 여전히 프록시의 비공개 키를 사용한다.
 */
export const CCTV_PUBLIC_BASE = "https://api.tf2027.xyz";
const CCTV_READONLY_KEY = "sk-tf2027-i92nehb82981u713";


export interface GatewayCamera {
  id: string;
  input_url: string;
  rtsp_transport: string;
  live_transcode: boolean;
  enabled: boolean;
  recording: boolean;
  live_playlist: string | null;
}

/**
 * Calls the camera gateway. When this device sits on the same internal
 * network the request goes straight to the gateway; otherwise it is relayed
 * through the edge proxy (API key stays server-side).
 */
export async function cctvFetch(pathOrUrl: string, init?: RequestInit) {
  const direct = getDirectBase();
  const target = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${direct || CCTV_PROXY_BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  // The LAN gateway is unauthenticated; sending Supabase headers there would
  // only trigger needless CORS preflights.
  if (direct && target.startsWith(direct)) return fetch(target, init);

  // 조회(GET/HEAD)는 읽기 전용 키로 게이트웨이에 직접 요청한다.
  const method = (init?.method || "GET").toUpperCase();
  if (!direct && !pathOrUrl.startsWith("http") && (method === "GET" || method === "HEAD")) {
    const url = `${CCTV_PUBLIC_BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
    const h = new Headers(init?.headers);
    h.set("X-API-Key", CCTV_READONLY_KEY);
    try {
      const res = await fetch(url, { ...init, headers: h });
      // 프록시와 동일하게 장비 오프라인(5xx)은 오류가 아닌 상태로 전달한다.
      if (res.status >= 500) {
        const body = await res.text().catch(() => "");
        let payload: Record<string, unknown> = {};
        try { const p = JSON.parse(body); if (p && typeof p === "object") payload = p; } catch { /* noop */ }
        return new Response(
          JSON.stringify({ ...payload, offline: true, upstream_status: res.status }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return res;
    } catch {
      return new Response(JSON.stringify({ offline: true, upstream_status: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }


  const headers = new Headers(init?.headers);
  headers.set("apikey", ANON_KEY);
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // 엣지 런타임이 일시적으로 과부하(503 SERVICE_DEGRADED / 502)일 때는
  // 즉시 오류로 처리하지 않고 짧은 백오프로 최대 3회까지 재시도한다.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(target, { ...init, headers });
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= 3) break;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("gateway unreachable");
}


/** FastAPI errors come back either as a string or as a validation array. */
export async function cctvError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((e: any) => e?.msg).filter(Boolean).join(", ");
    return `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function listGatewayCameras(): Promise<GatewayCamera[]> {
  const res = await cctvFetch("/api/v1/cam");
  if (!res.ok) throw new Error(await cctvError(res));
  const data = await res.json();
  return Array.isArray(data) ? (data as GatewayCamera[]) : [];
}

export async function createGatewayCamera(body: Partial<GatewayCamera> & { id: string }) {
  const res = await cctvFetch("/api/v1/cam", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await cctvError(res));
  return res.json();
}

export async function patchGatewayCamera(id: string, body: Partial<GatewayCamera>) {
  const res = await cctvFetch(`/api/v1/cam/${encodeURIComponent(id)}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await cctvError(res));
  return res.json();
}

export async function deleteGatewayCamera(id: string) {
  const res = await cctvFetch(`/api/v1/cam/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await cctvError(res));
}

export async function setGatewayRecording(id: string, enabled: boolean) {
  const res = await cctvFetch(`/api/v1/cam/${encodeURIComponent(id)}/recording`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await cctvError(res));
  return res.json();
}

/* ------------------------------------------------------------------ *
 * Direct (LAN) access
 *
 * The gateway has no auth and allows any origin, so a browser that sits
 * on the same internal network can hit it directly instead of relaying
 * every HLS segment through the edge proxy. The LAN base URL is stored
 * server-side (shared by every device) and probed once per page load.
 * ------------------------------------------------------------------ */

export const CCTV_LAN_BASE_KEY = "cctv_lan_base";

let directBase: string | null | undefined;
let directProbe: Promise<string | null> | null = null;

export function getDirectBase(): string | null {
  return directBase ?? null;
}

export async function loadCctvLanBase(): Promise<string> {
  const { data } = await supabase
    .from("app_ui_settings")
    .select("setting_value")
    .eq("setting_key", CCTV_LAN_BASE_KEY)
    .maybeSingle();
  const raw = data?.setting_value as unknown;
  const val = typeof raw === "string" ? raw : (raw as { url?: string } | null)?.url ?? "";
  return String(val || "").trim();
}

export async function saveCctvLanBase(base: string) {
  const clean = base.trim().replace(/\/+$/, "");
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("app_ui_settings").upsert(
    { setting_key: CCTV_LAN_BASE_KEY, setting_value: clean as unknown as never, updated_by: auth.user?.id ?? null },
    { onConflict: "setting_key" },
  );
  if (error) throw new Error(error.message);
  directBase = undefined;
  directProbe = null;
}

/** Returns the LAN gateway base if this device can actually reach it, else null. */
export async function resolveDirectBase(): Promise<string | null> {
  if (directBase !== undefined) return directBase;
  if (!directProbe) {
    directProbe = (async () => {
      try {
        const base = (await loadCctvLanBase()).replace(/\/+$/, "");
        if (!base) return null;
        // An https page cannot load http:// LAN resources (mixed content).
        if (window.location.protocol === "https:" && base.startsWith("http://")) return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2000);
        try {
          const res = await fetch(`${base}/api/v1/cam`, { signal: ctrl.signal, cache: "no-store" });
          return res.ok ? base : null;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return null;
      }
    })().then((v) => {
      directBase = v;
      return v;
    });
  }
  return directProbe;
}

/** Builds a playable/fetchable URL, preferring the direct LAN gateway. */
export function cctvUrl(pathOrUrl: string | null | undefined, base?: string | null): string | null {
  if (!pathOrUrl) return null;
  const root = (base ?? getDirectBase()) || CCTV_PROXY_BASE;
  try {
    let path: string;
    if (/^https?:\/\//i.test(pathOrUrl)) {
      const parsed = new URL(pathOrUrl);
      path = parsed.pathname + parsed.search;
    } else {
      path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    }
    return `${root}${path}`;
  } catch {
    return null;
  }
}

/** True when the URL points at the LAN gateway (no Supabase auth headers needed). */
export function isDirectUrl(url: string, base?: string | null): boolean {
  const root = (base ?? getDirectBase()) || "";
  return !!root && url.startsWith(root);
}
