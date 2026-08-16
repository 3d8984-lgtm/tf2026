// Local printer agent client (택배 송장 인쇄 에이전트).
//
// The agent runs on the operator's PC and exposes a plain HTTP API on
// 127.0.0.1:9100. Browsers treat http://127.0.0.1 as a *potentially trustworthy*
// origin, so calling it from the HTTPS site is NOT blocked as mixed content.
// CORS still applies: the agent must answer the preflight (OPTIONS) with
// Access-Control-Allow-Origin/Headers. To keep that surface minimal we:
//   1. send the PDF as a raw body (Content-Type: application/pdf) — one preflight,
//   2. fall back to a JSON { pdfUrl } request,
//   3. fall back to a *preflight-free* text/plain request (simple request, no
//      OPTIONS round-trip) so a agent build without OPTIONS handling still works.
// If every attempt fails the caller falls back to the browser print dialog.

export const PRINT_AGENT_DEFAULT_URL = "http://127.0.0.1:9100";

const normalize = (base?: string | null) =>
  (base?.trim() || PRINT_AGENT_DEFAULT_URL).replace(/\/+$/, "");

export interface PrintAgentSettings {
  enabled: boolean;
  baseUrl: string;
  printerName: string;
}

export const PRINT_AGENT_SETTING_KEY = "shipping_print_agent";
export const PRINT_AGENT_DEFAULTS: PrintAgentSettings = {
  enabled: true,
  baseUrl: PRINT_AGENT_DEFAULT_URL,
  printerName: "",
};

/** GET /health → { status: "ok" }. Returns false on any network/CORS failure. */
export async function checkPrintAgent(base?: string, timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${normalize(base)}/health`, { signal: ctrl.signal });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return (j as any)?.status ? (j as any).status === "ok" : true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface PrintJob {
  /** Raw PDF bytes — preferred transport (no download on the agent side). */
  pdf?: Blob | ArrayBuffer | null;
  /** Remote PDF URL — used when bytes are not available. */
  pdfUrl?: string | null;
  courierCode?: string | null;
  copies?: number;
  trackingNumber?: string | null;
  printerName?: string | null;
  baseUrl?: string | null;
}

function query(job: PrintJob) {
  const p = new URLSearchParams();
  if (job.courierCode) p.set("courierCode", job.courierCode.toUpperCase());
  if (job.trackingNumber) p.set("trackingNumber", job.trackingNumber);
  if (job.copies && job.copies > 1) p.set("copies", String(job.copies));
  if (job.printerName) p.set("printerName", job.printerName);
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function toBlob(pdf: Blob | ArrayBuffer): Promise<Blob> {
  return pdf instanceof Blob ? pdf : new Blob([pdf], { type: "application/pdf" });
}

/**
 * Sends one label to the local agent. Resolves with the transport that worked,
 * throws when every transport failed (caller should fall back to window.print).
 */
export async function printPdfViaAgent(job: PrintJob): Promise<{ via: "binary" | "json" | "simple" }> {
  const base = normalize(job.baseUrl);
  const url = `${base}/print${query(job)}`;
  const errors: string[] = [];

  // 1) Binary upload (preferred).
  if (job.pdf) {
    try {
      const blob = await toBlob(job.pdf);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: blob,
      });
      if (r.ok) return { via: "binary" };
      errors.push(`binary ${r.status}: ${(await r.text()).slice(0, 160)}`);
    } catch (e) {
      errors.push(`binary ${(e as Error).message}`);
    }
  }

  // 2) JSON with a PDF URL.
  if (job.pdfUrl && !job.pdfUrl.startsWith("blob:")) {
    try {
      const r = await fetch(`${base}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfUrl: job.pdfUrl,
          courierCode: (job.courierCode ?? "").toUpperCase() || undefined,
          copies: job.copies ?? 1,
          trackingNumber: job.trackingNumber ?? undefined,
          printerName: job.printerName || undefined,
        }),
      });
      if (r.ok) return { via: "json" };
      errors.push(`json ${r.status}: ${(await r.text()).slice(0, 160)}`);
    } catch (e) {
      errors.push(`json ${(e as Error).message}`);
    }
  }

  // 3) Preflight-free simple request (text/plain body carrying the same JSON).
  if (job.pdfUrl && !job.pdfUrl.startsWith("blob:")) {
    try {
      const r = await fetch(`${base}/print`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          pdfUrl: job.pdfUrl,
          courierCode: (job.courierCode ?? "").toUpperCase() || undefined,
          copies: job.copies ?? 1,
          trackingNumber: job.trackingNumber ?? undefined,
          printerName: job.printerName || undefined,
        }),
      });
      if (r.ok) return { via: "simple" };
      errors.push(`simple ${r.status}`);
    } catch (e) {
      errors.push(`simple ${(e as Error).message}`);
    }
  }

  throw new Error(errors.join(" | ") || "print agent unreachable");
}

/** Resolves a (possibly blob:) label URL into PDF bytes for binary upload. */
export async function fetchLabelPdf(url: string): Promise<Blob | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return blob.type === "application/pdf" || url.startsWith("blob:") || /\.pdf(\?|$)/i.test(url) || /^data:application\/pdf/i.test(url)
      ? new Blob([await blob.arrayBuffer()], { type: "application/pdf" })
      : null;
  } catch {
    return null;
  }
}
