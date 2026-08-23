import { supabase } from "@/integrations/supabase/client";

export const CCTV_PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export interface GatewayCamera {
  id: string;
  input_url: string;
  rtsp_transport: string;
  live_transcode: boolean;
  enabled: boolean;
  recording: boolean;
  live_playlist: string | null;
}

/** Calls the camera gateway through the edge proxy (API key stays server-side). */
export async function cctvFetch(pathOrUrl: string, init?: RequestInit) {
  const direct = getDirectBase();
  const target = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${CCTV_PROXY_BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  const headers = new Headers(init?.headers);
  headers.set("apikey", ANON_KEY);
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(target, { ...init, headers });
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
