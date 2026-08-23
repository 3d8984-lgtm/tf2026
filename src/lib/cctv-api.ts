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
