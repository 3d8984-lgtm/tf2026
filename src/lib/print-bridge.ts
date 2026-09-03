// Local Print Bridge 클라이언트.
// 포장기 옆 Windows PC 에서 실행되는 브리지 프로그램(localhost HTTP API)과 통신한다.
// 브라우저가 프린터를 직접 제어하지 않고, 브리지가 Windows Print Queue / 드라이버를 통해 출력한다.
//
//  GET  /health          → { status: "ok", ... }
//  GET  /printers        → { printers: [{ name, isDefault }] }
//  POST /print           → { jobId, status }
//  GET  /jobs/:jobId     → { jobId, status, error }
//  POST /cancel/:jobId   → { cancelled: boolean }

import type { QrLabelTemplate } from "./qr-label-template";

export const PRINT_BRIDGE_DEFAULT_URL = "http://127.0.0.1:9110";

const base = (url?: string | null) =>
  (url?.trim() || PRINT_BRIDGE_DEFAULT_URL).replace(/\/+$/, "");

export type BridgeJobStatus =
  | "queued"
  | "printing"
  | "printer_accepted"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export type BridgePrintItem = {
  position: number;
  stickerUniqueId: string;
  editionNumber: string;
};

export type BridgePrintJob = {
  jobId: string;
  orderId: string;
  printer: string;
  label: {
    widthMm: number;
    heightMm: number;
    columns: number;
    horizontalGapMm: number;
    verticalGapMm?: number;
    marginTopMm?: number;
    marginBottomMm?: number;
    marginLeftMm?: number;
    marginRightMm?: number;
    orientation?: string;
    dpi?: number;
    qr?: Record<string, unknown>;
    edition?: Record<string, unknown>;
  };
  items: BridgePrintItem[];
};

async function req(url: string, init?: RequestInit, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function bridgeHealth(url?: string): Promise<boolean> {
  try {
    const r = await req(`${base(url)}/health`, undefined, 1500);
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return (j as any)?.status ? (j as any).status === "ok" : true;
  } catch {
    return false;
  }
}

export type BridgePrinter = { name: string; isDefault?: boolean; online?: boolean };

export async function bridgePrinters(url?: string): Promise<BridgePrinter[]> {
  try {
    const r = await req(`${base(url)}/printers`, undefined, 3000);
    if (!r.ok) return [];
    const j: any = await r.json();
    const list = Array.isArray(j) ? j : j?.printers;
    return Array.isArray(list)
      ? list.map((p: any) => (typeof p === "string" ? { name: p } : { name: p.name, isDefault: !!p.isDefault, online: p.online }))
      : [];
  } catch {
    return [];
  }
}

/** 선택된 프린터가 브리지에 존재하는지 (= 연결됨) */
export async function bridgePrinterOnline(printerName: string, url?: string): Promise<boolean> {
  if (!printerName) return false;
  const list = await bridgePrinters(url);
  const hit = list.find((p) => p.name.toLowerCase() === printerName.toLowerCase());
  return !!hit && hit.online !== false;
}

export function labelPayload(t: QrLabelTemplate): BridgePrintJob["label"] {
  return {
    widthMm: t.label_width,
    heightMm: t.label_height,
    columns: t.columns,
    horizontalGapMm: t.horizontal_gap,
    verticalGapMm: t.vertical_gap,
    marginTopMm: t.margin_top,
    marginBottomMm: t.margin_bottom,
    marginLeftMm: t.margin_left,
    marginRightMm: t.margin_right,
    orientation: t.orientation,
    dpi: t.dpi,
    qr: {
      xMm: t.qr_x, yMm: t.qr_y, widthMm: t.qr_width, heightMm: t.qr_height,
      errorLevel: t.qr_error_level, quietZoneMm: t.qr_quiet_zone,
    },
    edition: {
      xMm: t.edition_x, yMm: t.edition_y, fontSizePt: t.edition_font_size,
      fontFamily: t.edition_font_family, fontWeight: t.edition_font_weight,
      alignment: t.edition_alignment,
    },
  };
}

export type BridgeSendResult = { jobId: string; status: BridgeJobStatus };

export async function bridgePrint(job: BridgePrintJob, url?: string): Promise<BridgeSendResult> {
  const r = await req(`${base(url)}/print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  }, 20000);
  const text = await r.text();
  if (!r.ok) throw new Error(`bridge ${r.status}: ${text.slice(0, 200)}`);
  let j: any = {};
  try { j = JSON.parse(text); } catch { /* 브리지가 빈 응답을 줄 수 있다 */ }
  return { jobId: String(j.jobId ?? job.jobId), status: (j.status as BridgeJobStatus) ?? "printer_accepted" };
}

export async function bridgeJobStatus(jobId: string, url?: string): Promise<{ status: BridgeJobStatus; error?: string | null }> {
  try {
    const r = await req(`${base(url)}/jobs/${encodeURIComponent(jobId)}`, undefined, 4000);
    if (!r.ok) return { status: "unknown" };
    const j: any = await r.json();
    return { status: (j?.status as BridgeJobStatus) ?? "unknown", error: j?.error ?? null };
  } catch {
    return { status: "unknown" };
  }
}

export async function bridgeCancel(jobId: string, url?: string): Promise<boolean> {
  try {
    const r = await req(`${base(url)}/cancel/${encodeURIComponent(jobId)}`, { method: "POST" }, 4000);
    return r.ok;
  } catch {
    return false;
  }
}

/** 이 PC를 식별하는 값 (브라우저 로컬 저장 — 기록용이며 설정 원본이 아님) */
export function computerId(): string {
  const KEY = "print_bridge_computer_id";
  let v = localStorage.getItem(KEY);
  if (!v) {
    v = `PC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    localStorage.setItem(KEY, v);
  }
  return v;
}
