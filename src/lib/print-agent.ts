// Local print-agent client (127.0.0.1:9100, API.md 기준).
//
// - GET  /health → { status: "ok" }
// - POST /print  → JSON { pdfUrl, copies, labelWidthMm, labelHeightMm } 또는
//                  바이너리 PDF (부가 정보는 쿼리 파라미터)
// - /print 는 동기 방식: 실제 인쇄 명령이 끝난 뒤에야 200 { success: true } 응답.
// - printerName 은 에이전트가 무시한다(항상 트레이에서 선택된 프린터로 출력).
// - 용지 크기는 labelWidthMm/labelHeightMm > PDF 페이지 크기 > 트레이 고정값 순.
// - 포트는 트레이에서 변경 가능하므로 localStorage 에 저장된 포트 → 9100 순으로 탐색.
// - 오류 응답은 text/plain 한국어 메시지. "프린터를 먼저 선택" 포함 시 트레이 안내.

export const PRINT_AGENT_DEFAULT_URL = "http://127.0.0.1:9100";
export const PRINT_AGENT_PORT_KEY = "printAgentPort";

const normalize = (base?: string | null) =>
  (base?.trim() || PRINT_AGENT_DEFAULT_URL).replace(/\/+$/, "");

async function probeHealth(url: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/health`, { signal: ctrl.signal });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return (j as any)?.status ? (j as any).status === "ok" : true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 저장된 포트 → 기본 포트(9100) 순으로 에이전트를 찾아 포트를 반환한다. */
export async function resolveAgentPort(timeoutMs = 1200): Promise<number | null> {
  let saved: number | null = null;
  try {
    const v = Number(localStorage.getItem(PRINT_AGENT_PORT_KEY));
    if (Number.isFinite(v) && v > 0 && v < 65536) saved = v;
  } catch { /* localStorage 사용 불가 환경 */ }
  const candidates = saved && saved !== 9100 ? [saved, 9100] : [9100];
  for (const port of candidates) {
    if (await probeHealth(`http://127.0.0.1:${port}`, timeoutMs)) {
      try { localStorage.setItem(PRINT_AGENT_PORT_KEY, String(port)); } catch { /* noop */ }
      return port;
    }
  }
  return null;
}

/** GET /health → { status: "ok" }. base 생략 시 포트 자동 탐색. */
export async function checkPrintAgent(base?: string, timeoutMs = 1500): Promise<boolean> {
  if (base?.trim()) return probeHealth(normalize(base), timeoutMs);
  return (await resolveAgentPort(Math.min(timeoutMs, 1200))) !== null;
}

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

export interface PrintJob {
  /** Raw PDF bytes — preferred transport (no download on the agent side). */
  pdf?: Blob | ArrayBuffer | null;
  /** Remote PDF URL — used when bytes are not available. */
  pdfUrl?: string | null;
  courierCode?: string | null;
  copies?: number;
  trackingNumber?: string | null;
  /** @deprecated 에이전트가 무시한다(항상 트레이 선택 프린터 사용). 호환용으로만 유지. */
  printerName?: string | null;
  /** 라벨 실물 가로(mm) — PDF 크기 추정보다 우선한다. */
  labelWidthMm?: number | null;
  /** 라벨 실물 세로(mm) — PDF 크기 추정보다 우선한다. */
  labelHeightMm?: number | null;
  baseUrl?: string | null;
  jobId?: string | null;
  dpi?: number | null;
  pixelWidth?: number | null;
  pixelHeight?: number | null;
  imageFormat?: string | null;
  orientation?: "portrait" | "landscape" | null;
}

export type AgentDriverInfo = {
  dpiX?: number | null;
  dpiY?: number | null;
  physicalWidthPx?: number | null;
  physicalHeightPx?: number | null;
  printableWidthPx?: number | null;
  printableHeightPx?: number | null;
  physicalOffsetXPx?: number | null;
  physicalOffsetYPx?: number | null;
  pageUnit?: string | null;
};

export type PrintAgentCapabilities = {
  online: boolean;
  version: string | null;
  rawPng: boolean;
  hashVerification: boolean;
  driverDiagnostics: boolean;
  endpoint: string;
  driver: AgentDriverInfo | null;
};

export type RawPngPrintResult = {
  verified: boolean;
  requestedSha256: string;
  receivedSha256: string | null;
  requestedPixelWidth: number;
  requestedPixelHeight: number;
  receivedPixelWidth: number | null;
  receivedPixelHeight: number | null;
  driver: AgentDriverInfo | null;
};

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseCapabilities(raw: any, online: boolean): PrintAgentCapabilities {
  const features = raw?.capabilities ?? raw?.features ?? {};
  const driver = raw?.driver ?? raw?.printerCapabilities ?? null;
  return {
    online,
    version: raw?.version ? String(raw.version) : null,
    rawPng: features.rawPng === true || features.rawBitmap === true || raw?.rawPng === true,
    hashVerification: features.sha256 === true || features.hashVerification === true || raw?.hashVerification === true,
    driverDiagnostics: features.driverDiagnostics === true || !!driver,
    endpoint: String(features.rawPngEndpoint ?? raw?.rawPngEndpoint ?? "/print-image"),
    driver: driver ? {
      dpiX: finiteNumber(driver.dpiX ?? driver.LOGPIXELSX),
      dpiY: finiteNumber(driver.dpiY ?? driver.LOGPIXELSY),
      physicalWidthPx: finiteNumber(driver.physicalWidthPx ?? driver.PHYSICALWIDTH),
      physicalHeightPx: finiteNumber(driver.physicalHeightPx ?? driver.PHYSICALHEIGHT),
      printableWidthPx: finiteNumber(driver.printableWidthPx ?? driver.HORZRES),
      printableHeightPx: finiteNumber(driver.printableHeightPx ?? driver.VERTRES),
      physicalOffsetXPx: finiteNumber(driver.physicalOffsetXPx ?? driver.PHYSICALOFFSETX),
      physicalOffsetYPx: finiteNumber(driver.physicalOffsetYPx ?? driver.PHYSICALOFFSETY),
      pageUnit: driver.pageUnit ? String(driver.pageUnit) : null,
    } : null,
  };
}

/** 실행 중인 Agent가 PNG 무변환 출력 및 검증 정보를 제공하는지 확인한다. */
export async function getPrintAgentCapabilities(baseUrl?: string): Promise<PrintAgentCapabilities> {
  let agentBase: string;
  if (baseUrl?.trim()) agentBase = normalize(baseUrl);
  else {
    const port = await resolveAgentPort();
    if (!port) return parseCapabilities({}, false);
    agentBase = `http://127.0.0.1:${port}`;
  }
  try {
    const response = await fetch(`${agentBase}/health`);
    if (!response.ok) return parseCapabilities({}, false);
    return parseCapabilities(await response.json().catch(() => ({})), true);
  } catch {
    return parseCapabilities({}, false);
  }
}

export async function printRawPngViaAgent({
  png, widthMm, heightMm, dpi, pixelWidth, pixelHeight, sha256, jobId, baseUrl,
}: {
  png: Blob;
  widthMm: number;
  heightMm: number;
  dpi: number;
  pixelWidth: number;
  pixelHeight: number;
  sha256: string;
  jobId?: string;
  baseUrl?: string;
}): Promise<RawPngPrintResult> {
  const capabilities = await getPrintAgentCapabilities(baseUrl);
  if (!capabilities.online) throw new Error("인쇄 에이전트를 찾을 수 없습니다.");
  if (!capabilities.rawPng) throw new Error("현재 인쇄 에이전트는 RAW PNG 1:1 출력을 지원하지 않습니다. 에이전트 업데이트가 필요합니다.");
  let agentBase: string;
  if (baseUrl?.trim()) agentBase = normalize(baseUrl);
  else {
    const port = await resolveAgentPort();
    if (!port) throw new Error("인쇄 에이전트를 찾을 수 없습니다.");
    agentBase = `http://127.0.0.1:${port}`;
  }
  const endpoint = capabilities.endpoint.startsWith("/") ? capabilities.endpoint : `/${capabilities.endpoint}`;
  const response = await fetch(`${agentBase}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-Image-Sha256": sha256,
      "X-Pixel-Width": String(pixelWidth),
      "X-Pixel-Height": String(pixelHeight),
      "X-Physical-Width-Mm": String(widthMm),
      "X-Physical-Height-Mm": String(heightMm),
      "X-Requested-Dpi": String(dpi),
      "X-Raw-Device-Pixels": "true",
      "X-Fit-To-Page": "false",
      "X-Auto-Resize": "false",
      "X-Auto-Crop": "false",
      "X-Auto-Rotate": "false",
      "X-Page-Slicing": "false",
      ...(jobId ? { "X-Print-Job-Id": jobId } : {}),
    },
    body: png,
  });
  if (!response.ok) throw new Error(await agentError("RAW PNG", response));
  const body = await response.json().catch(() => ({})) as any;
  const receivedSha256 = body.receivedSha256 ? String(body.receivedSha256).toLowerCase() : null;
  const receivedPixelWidth = finiteNumber(body.receivedPixelWidth ?? body.pixelWidth);
  const receivedPixelHeight = finiteNumber(body.receivedPixelHeight ?? body.pixelHeight);
  if (capabilities.hashVerification && receivedSha256 !== sha256.toLowerCase()) {
    throw new Error("Agent 수신 PNG의 SHA-256이 원본과 다릅니다. 인쇄를 중단했습니다.");
  }
  if (receivedPixelWidth !== null && receivedPixelWidth !== pixelWidth) throw new Error("Agent에서 PNG 가로 픽셀 크기가 변경되어 인쇄를 중단했습니다.");
  if (receivedPixelHeight !== null && receivedPixelHeight !== pixelHeight) throw new Error("Agent에서 PNG 세로 픽셀 크기가 변경되어 인쇄를 중단했습니다.");
  return {
    verified: capabilities.hashVerification && receivedSha256 === sha256.toLowerCase()
      && receivedPixelWidth === pixelWidth && receivedPixelHeight === pixelHeight,
    requestedSha256: sha256,
    receivedSha256,
    requestedPixelWidth: pixelWidth,
    requestedPixelHeight: pixelHeight,
    receivedPixelWidth,
    receivedPixelHeight,
    driver: body.driver ?? capabilities.driver,
  };
}

function query(job: PrintJob) {
  const p = new URLSearchParams();
  if (job.courierCode) p.set("courierCode", job.courierCode.toUpperCase());
  if (job.trackingNumber) p.set("trackingNumber", job.trackingNumber);
  if (job.labelWidthMm && job.labelWidthMm > 0) {
    // 에이전트 버전별 파라미터 이름 차이를 흡수한다(모두 같은 값).
    p.set("labelWidthMm", String(job.labelWidthMm));
    p.set("widthMm", String(job.labelWidthMm));
    p.set("paperWidthMm", String(job.labelWidthMm));
  }
  if (job.labelHeightMm && job.labelHeightMm > 0) {
    p.set("labelHeightMm", String(job.labelHeightMm));
    p.set("heightMm", String(job.labelHeightMm));
    p.set("paperHeightMm", String(job.labelHeightMm));
  }
  // 큰 용지에 맞춰 축소/여백 추가하지 말고 PDF 페이지 크기 그대로 출력.
  p.set("fitToPage", "false");
  p.set("scale", "100");
  p.set("scalePercent", "100");
  p.set("usePdfPageSize", "true");
  p.set("shrinkToFit", "false");
  p.set("autoResize", "false");
  p.set("autoRotate", "false");
  p.set("autoCrop", "false");
  p.set("pageSlicing", "false");
  p.set("stretch", "false");
  p.set("marginCompensation", "false");
  if (job.dpi) p.set("dpi", String(job.dpi));
  if (job.orientation) p.set("orientation", job.orientation);
  const s = p.toString();
  return s ? `?${s}` : "";
}


async function toBlob(pdf: Blob | ArrayBuffer): Promise<Blob> {
  return pdf instanceof Blob ? pdf : new Blob([pdf], { type: "application/pdf" });
}

function jsonBody(job: PrintJob) {
  return JSON.stringify({
    pdfUrl: job.pdfUrl,
    courierCode: (job.courierCode ?? "").toUpperCase() || undefined,
    copies: job.copies ?? 1,
    trackingNumber: job.trackingNumber ?? undefined,
    labelWidthMm: job.labelWidthMm && job.labelWidthMm > 0 ? job.labelWidthMm : undefined,
    labelHeightMm: job.labelHeightMm && job.labelHeightMm > 0 ? job.labelHeightMm : undefined,
  });
}

/** 에이전트 오류 메시지(text/plain 한국어)를 그대로 담은 Error 를 만든다. */
async function agentError(prefix: string, r: Response): Promise<string> {
  const msg = (await r.text()).trim().slice(0, 300);
  return `${prefix} ${r.status}${msg ? `: ${msg}` : ""}`;
}

/** 사용자에게 보여줄 친화적 안내 — 프린터 미선택은 트레이 설정 안내로 분기 */
export function friendlyAgentError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err ?? "");
  if (msg.includes("프린터를 먼저 선택") || msg.includes("지정되지 않았습니다")) {
    return "사용할 프린터가 지정되지 않았습니다. 트레이 아이콘에서 프린터를 먼저 선택해 주세요.";
  }
  return msg || "인쇄 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

/**
 * Sends one label to the local agent. Resolves with the transport that worked,
 * throws when every transport failed (caller should fall back to window.print).
 */
export async function printPdfViaAgent(job: PrintJob): Promise<{ via: "binary" | "json" | "simple" }> {
  let base: string;
  if (job.baseUrl?.trim()) {
    base = normalize(job.baseUrl);
  } else {
    const port = await resolveAgentPort();
    if (!port) throw new Error("인쇄 에이전트를 찾을 수 없습니다. 에이전트 실행 여부와 포트를 확인해 주세요.");
    base = `http://127.0.0.1:${port}`;
  }
  const url = `${base}/print${query(job)}`;
  const errors: string[] = [];

  console.info("[Print Agent Payload]", {
    jobId: job.jobId ?? null,
    printerName: job.printerName ?? null,
    widthMm: job.labelWidthMm ?? null,
    heightMm: job.labelHeightMm ?? null,
    dpi: job.dpi ?? null,
    pixelWidth: job.pixelWidth ?? null,
    pixelHeight: job.pixelHeight ?? null,
    imageFormat: job.imageFormat ?? "PDF",
    scale: "100%",
    orientation: job.orientation ?? null,
    copies: job.copies ?? 1,
    mediaWidthMm: job.labelWidthMm ?? null,
    mediaHeightMm: job.labelHeightMm ?? null,
    pageWidthMm: job.labelWidthMm ?? null,
    pageHeightMm: job.labelHeightMm ?? null,
    fitToPage: false,
    stretch: false,
    resize: false,
    autoRotate: false,
    autoCrop: false,
    pageSlicing: false,
    marginCompensation: false,
  });

  // 1) Binary upload (preferred).
  if (job.pdf) {
    try {
      const blob = await toBlob(job.pdf);
      const headers: Record<string, string> = { "Content-Type": "application/pdf" };
      if (job.labelWidthMm && job.labelWidthMm > 0) headers["X-Label-Width-Mm"] = String(job.labelWidthMm);
      if (job.labelHeightMm && job.labelHeightMm > 0) headers["X-Label-Height-Mm"] = String(job.labelHeightMm);
      headers["X-Fit-To-Page"] = "false";
      headers["X-Scale-Percent"] = "100";
      headers["X-Use-Pdf-Page-Size"] = "true";
      headers["X-Shrink-To-Fit"] = "false";
      headers["X-Auto-Resize"] = "false";
      headers["X-Auto-Rotate"] = "false";
      headers["X-Auto-Crop"] = "false";
      headers["X-Page-Slicing"] = "false";
      headers["X-Stretch"] = "false";
      headers["X-Margin-Compensation"] = "false";
      if (job.dpi) headers["X-Printer-Dpi"] = String(job.dpi);
      if (job.pixelWidth) headers["X-Pixel-Width"] = String(job.pixelWidth);
      if (job.pixelHeight) headers["X-Pixel-Height"] = String(job.pixelHeight);
      if (job.imageFormat) headers["X-Source-Image-Format"] = job.imageFormat;
      if (job.orientation) headers["X-Orientation"] = job.orientation;
      if (job.jobId) headers["X-Print-Job-Id"] = job.jobId;
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: blob,
      });

      if (r.ok) return { via: "binary" };
      errors.push(await agentError("binary", r));
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
        body: jsonBody(job),
      });
      if (r.ok) return { via: "json" };
      errors.push(await agentError("json", r));
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
        body: jsonBody(job),
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
