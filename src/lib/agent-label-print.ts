// 로컬 프린트 에이전트(127.0.0.1:9100)로 QR 라벨을 PDF로 전송해 출력한다.
// 에이전트가 PDF 사이즈에 맞춰 프린터 용지를 자동으로 맞춰 인쇄한다.
//
//   건강 확인: GET  http://127.0.0.1:9100/health → { status: "ok" }
//   인쇄:      POST http://127.0.0.1:9100/print  (body = PDF bytes)
//
// 모든 행을 하나의 연속 롤 PDF 페이지에 배치한다.
// QR은 이미지로, 에디션 텍스트와 진단 도형은 벡터로 그린다.

import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { resolveBottomEditionBox, resolveMediaLayout, type QrLabelTemplate } from "./qr-label-template";
import { checkPrintAgent, getPrintAgentCapabilities, printPdfViaAgent, printRawPngViaAgent, type RawPngPrintResult } from "./print-agent";
import { rasterizePrintPdf, type FinalLabelRaster } from "./final-label-raster";

export type AgentLabelItem = { position: number; code: string; edition: string };
export type DiagnosticMode = "cross" | "square" | "qr";

export type LabelLayoutEntry = {
  itemIndex: number;
  row: number;
  column: number;
  labelXmm: number;
  labelYmm: number;
  qrCenterXmm: number;
  qrCenterYmm: number;
  qrLeftMm: number;
  qrTopMm: number;
  qrAbsoluteXmm: number;
  qrAbsoluteYmm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  horizontalPitchMm: number;
  verticalPitchMm: number;
};

export type LabelDocumentLayout = {
  widthMm: number;
  heightMm: number;
  rows: number;
  columns: number;
  entries: LabelLayoutEntry[];
};

const PT_PER_MM = 72 / 25.4;
const mm = (v: number) => v * PT_PER_MM;
const roundMm = (v: number) => Math.round(v * 10000) / 10000;

async function qrDataUrl(value: string, level: QrLabelTemplate["qr_error_level"]) {
  return QRCode.toDataURL(value || " ", { errorCorrectionLevel: level, margin: 0, scale: 10 });
}

/**
 * 실제 인쇄 페이지 크기(mm/pt).
 * 프린터가 다이컷 센서로 라벨 경계를 직접 잡으므로 한 페이지 = 한 줄(라벨 1행)이며
 * 세로 여백/간격은 넣지 않는다. 좌우 여백과 칸 간격만 반영한다.
 */
export function labelPageSizePt(t: QrLabelTemplate, itemCount = Math.max(1, Math.round(Number(t.columns) || 1))) {
  const cols = Math.max(1, Math.round(Number(t.columns) || 1));
  const cellW = Math.max(1, Number(t.label_width) || 0);
  const cellH = t.label_shape === "round" ? cellW : Math.max(1, Number(t.label_height) || 0);
  // 용지 너비·다이컷 마진 기준 자동 계산(켠 경우) 또는 저장된 여백/간격
  const media = resolveMediaLayout(t);
  const gapX = media.horizontalGapMm;
  const gapY = Math.max(0, Number(t.vertical_gap) || 0);
  const ml = media.marginLeftMm;
  const mr = media.marginRightMm;
  const wMm = media.pageWidthMm;
  const rows = Math.max(1, Math.ceil(Math.max(1, itemCount) / cols));
  const horizontalPitchMm = cellW + gapX;
  const verticalPitchMm = cellH;
  // 한 페이지 = 한 줄. 세로 길이는 라벨 높이 그 자체.
  const hMm = cellH;
  return {
    wMm, hMm, w: mm(wMm), h: mm(hMm), rows, cols, cellW, cellH,
    gapX, gapY, ml, mr, mt: 0, mb: 0, horizontalPitchMm, verticalPitchMm,
  };
}

/** 한 페이지(한 줄)에 들어가는 라벨 수 */
export function rowCapacity(t: QrLabelTemplate): number {
  return Math.max(1, Math.round(Number(t.columns) || 1));
}

/** 아이템을 한 줄(페이지)씩 나눈다. */
export function chunkRows(t: QrLabelTemplate, items: AgentLabelItem[]): AgentLabelItem[][] {
  const size = rowCapacity(t);
  const out: AgentLabelItem[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createLabelDocumentLayout(t: QrLabelTemplate, itemCount: number): LabelDocumentLayout {
  const size = labelPageSizePt(t, itemCount);
  const quiet = Math.max(0, Number(t.qr_quiet_zone) || 0);
  const qw = Math.min(Math.max(1, Number(t.qr_width) || 1), Math.max(1, size.cellW - quiet * 2));
  const qh = Math.min(Math.max(1, Number(t.qr_height) || 1), Math.max(1, size.cellH - quiet * 2));
  const qrCenterXmm = Math.min(Math.max(qw / 2, Number(t.qr_x) || 0), Math.max(qw / 2, size.cellW - qw / 2));
  const qrCenterYmm = Math.min(Math.max(qh / 2, Number(t.qr_y) || 0), Math.max(qh / 2, size.cellH - qh / 2));
  const qrLeftMm = qrCenterXmm - qw / 2;
  const qrTopMm = qrCenterYmm - qh / 2;
  const entries = Array.from({ length: Math.max(0, itemCount) }, (_, itemIndex) => {
    const row = Math.floor(itemIndex / size.cols);
    const column = itemIndex % size.cols;
    const labelXmm = roundMm(size.ml + column * size.horizontalPitchMm);
    // 각 줄이 별도 페이지이므로 세로 좌표는 항상 페이지 상단(0)부터 시작한다.
    const labelYmm = 0;
    return {
      itemIndex, row, column, labelXmm, labelYmm,
      qrCenterXmm: roundMm(qrCenterXmm), qrCenterYmm: roundMm(qrCenterYmm),
      qrLeftMm: roundMm(qrLeftMm), qrTopMm: roundMm(qrTopMm),
      qrAbsoluteXmm: roundMm(labelXmm + qrLeftMm),
      qrAbsoluteYmm: roundMm(labelYmm + qrTopMm),
      labelWidthMm: size.cellW,
      labelHeightMm: size.cellH,
      horizontalPitchMm: size.horizontalPitchMm,
      verticalPitchMm: size.verticalPitchMm,
    };
  });
  return { widthMm: size.wMm, heightMm: size.hMm, rows: size.rows, columns: size.cols, entries };
}


function logPrintDebug(layout: LabelDocumentLayout, kind: "labels" | DiagnosticMode) {
  console.info("[QR Print Document]", {
    kind,
    widthMm: layout.widthMm,
    heightMm: layout.heightMm,
    rows: layout.rows,
    columns: layout.columns,
    renderCount: layout.entries.length,
  });
  console.table(layout.entries.slice(0, 10));
}

function assertLayout(layout: LabelDocumentLayout, expectedCount: number) {
  if (layout.entries.length !== expectedCount) throw new Error("print render count mismatch");
  const indexes = new Set(layout.entries.map((entry) => entry.itemIndex));
  if (indexes.size !== expectedCount) throw new Error("duplicate print item index");
  for (const entry of layout.entries) {
    const qrRight = entry.qrAbsoluteXmm + (entry.qrCenterXmm - entry.qrLeftMm) * 2;
    const qrBottom = entry.qrAbsoluteYmm + (entry.qrCenterYmm - entry.qrTopMm) * 2;
    if (entry.qrAbsoluteXmm < entry.labelXmm || qrRight > entry.labelXmm + entry.labelWidthMm + 1e-6
      || entry.qrAbsoluteYmm < entry.labelYmm || qrBottom > entry.labelYmm + entry.labelHeightMm + 1e-6) {
      throw new Error(`print item ${entry.itemIndex} exceeds label bounds`);
    }
  }
}

/**
 * 라벨 목록을 PDF Blob으로 만든다.
 * 한 페이지 = 한 줄(열 개수만큼). 줄이 늘어나면 페이지를 추가한다.
 */
export async function buildLabelsPdf(t: QrLabelTemplate, items: AgentLabelItem[]): Promise<Blob> {
  if (items.length === 0) throw new Error("no labels");
  const size = labelPageSizePt(t, items.length);
  const { w, h, cellW, cellH } = size;
  const orientation = w > h ? "landscape" : "portrait";
  const pdf = new jsPDF({ unit: "pt", format: [w, h], orientation, compress: true });
  const layout = createLabelDocumentLayout(t, items.length);
  assertLayout(layout, items.length);
  logPrintDebug(layout, "labels");

  const qrs = await Promise.all(items.map((i) => qrDataUrl(i.code, t.qr_error_level)));

  // QR 크기는 라벨 칸을 넘지 않도록 제한하고, 설정된 X/Y를 각 칸 기준으로 적용한다.
  const quiet = Math.max(0, Number(t.qr_quiet_zone) || 0);
  const qw = Math.min(Math.max(1, Number(t.qr_width) || 1), Math.max(1, cellW - quiet * 2));
  const qh = Math.min(Math.max(1, Number(t.qr_height) || 1), Math.max(1, cellH - quiet * 2));
  // qr_x/qr_y = QR 중심점 — 칸 안에 유지되도록 중심 범위를 제한한 뒤 좌상단으로 환산
  const centerX = Math.min(Math.max(qw / 2, Number(t.qr_x) || 0), Math.max(qw / 2, cellW - qw / 2));
  const centerY = Math.min(Math.max(qh / 2, Number(t.qr_y) || 0), Math.max(qh / 2, cellH - qh / 2));
  const centerT = { ...t, qr_x: centerX, qr_y: centerY, qr_width: qw, qr_height: qh };

  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, w, h, "F");

  let currentRow = 0;
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const entry = layout.entries[idx];
    if (!entry) throw new Error(`missing print layout for item ${idx}`);
    if (entry.row !== currentRow) {
      currentRow = entry.row;
      pdf.addPage([w, h], orientation);
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, w, h, "F");
    }
    const ox = entry.labelXmm;
    const oy = entry.labelYmm;

    // QR (각 칸 내부에서 라벨 설정의 X/Y 위치)
    pdf.addImage(
      qrs[idx], "PNG",
      mm(entry.qrAbsoluteXmm), mm(entry.qrAbsoluteYmm), mm(qw), mm(qh),
      undefined, "FAST",
    );


    const style = t.edition_font_weight === "bold" ? "bold" : "normal";
    pdf.setFont("helvetica", style);
    pdf.setTextColor(0, 0, 0);
    const text = String(it.edition ?? "");

    if (t.edition_placement === "qr_bottom" || t.edition_placement === "qr_center") {
      // QR 하단의 라벨 내부 여유 공간에 텍스트를 중앙 정렬한다.
      const box = resolveBottomEditionBox(centerT, text);
      pdf.setFontSize(box.fontPt);
      pdf.text(text, mm(ox + box.centerX), mm(oy + box.y + box.h / 2), {
        align: "center",
        baseline: "middle",
      } as any);
    } else {
      // 에디션 텍스트 — HTML 기준 top 좌표를 베이스라인으로 환산
      pdf.setFontSize(t.edition_font_size);
      const baselineY = mm(oy + t.edition_y) + t.edition_font_size;
      const align = t.edition_alignment;
      pdf.text(text, mm(ox + t.edition_x), baselineY, {
        align: align === "center" ? "center" : align === "right" ? "right" : "left",
        baseline: "alphabetic",
      } as any);
    }
  }

  return pdf.output("blob");
}

/** 라벨 설정에 저장된 프린터 실측 보정값 */
export function printCalibration(t: QrLabelTemplate) {
  return {
    offsetXmm: Number(t.print_offset_x) || 0,
    offsetYmm: Number(t.print_offset_y) || 0,
    scaleXPercent: Number(t.print_scale_x) || 100,
    scaleYPercent: Number(t.print_scale_y) || 100,
  };
}

/** 이동 보정(+)만큼 용지를 늘려 마지막 행이 잘리지 않게 한다. */
function paddedCanvas(wMm: number, hMm: number, cal: ReturnType<typeof printCalibration>) {
  return {
    canvasWidthMm: roundMm(wMm + Math.max(0, cal.offsetXmm)),
    canvasHeightMm: roundMm(hMm + Math.max(0, cal.offsetYmm)),
  };
}

/**
 * 화면 확인·PNG 다운로드·Agent 출력이 함께 사용하는 최종 래스터 결과.
 * 한 페이지 = 한 줄이므로 첫 줄(열 개수만큼)만 래스터한다.
 */
export async function buildFinalLabelRaster(t: QrLabelTemplate, items: AgentLabelItem[]): Promise<FinalLabelRaster> {
  const rowItems = items.slice(0, rowCapacity(t));
  const sourcePdf = await buildLabelsPdf(t, rowItems);
  const { wMm, hMm } = labelPageSizePt(t, rowItems.length);
  const cal = printCalibration(t);
  const { canvasWidthMm, canvasHeightMm } = paddedCanvas(wMm, hMm, cal);
  return rasterizePrintPdf(sourcePdf, canvasWidthMm, canvasHeightMm, t.printer_dpi || t.dpi, cal, {
    widthMm: wMm,
    heightMm: hMm,
  });
}

/** 진단 내용만 다르고 이후 래스터/전송 경로는 실제 라벨과 완전히 동일하다. */
export async function buildFinalDiagnosticRaster(t: QrLabelTemplate, mode: DiagnosticMode): Promise<FinalLabelRaster> {
  const diagnosticTemplate = { ...t, columns: 5 };
  const pdf = await buildDiagnosticPdf(diagnosticTemplate, mode, 5);
  const { wMm, hMm } = labelPageSizePt(diagnosticTemplate, 5);
  const cal = printCalibration(t);
  const { canvasWidthMm, canvasHeightMm } = paddedCanvas(wMm, hMm, cal);
  return rasterizePrintPdf(pdf, canvasWidthMm, canvasHeightMm, t.printer_dpi || t.dpi, cal, {
    widthMm: wMm,
    heightMm: hMm,
  });
}


/** 좌표 진단 문서 — 한 페이지 = 한 줄(5열). */
export async function buildDiagnosticPdf(t: QrLabelTemplate, mode: DiagnosticMode, count = 50): Promise<Blob> {
  const diagnosticTemplate = { ...t, columns: 5 };
  const size = labelPageSizePt(diagnosticTemplate, count);
  const layout = createLabelDocumentLayout(diagnosticTemplate, count);
  assertLayout(layout, count);
  logPrintDebug(layout, mode);
  const orientation = size.w > size.h ? "landscape" : "portrait";
  const pdf = new jsPDF({ unit: "pt", format: [size.w, size.h], orientation, compress: true });
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, size.w, size.h, "F");

  const qr = mode === "qr" ? await qrDataUrl("QR-POSITION-TEST", t.qr_error_level) : null;
  let currentRow = 0;
  for (const entry of layout.entries) {
    if (entry.row !== currentRow) {
      currentRow = entry.row;
      pdf.addPage([size.w, size.h], orientation);
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, size.w, size.h, "F");
    }
    const cx = entry.labelXmm + entry.labelWidthMm / 2;
    const cy = entry.labelYmm + entry.labelHeightMm / 2;
    pdf.setDrawColor(0, 0, 0);
    pdf.setFillColor(0, 0, 0);
    if (mode === "cross") {
      pdf.setLineWidth(mm(0.25));
      pdf.line(mm(cx - 1.5), mm(cy), mm(cx + 1.5), mm(cy));
      pdf.line(mm(cx), mm(cy - 1.5), mm(cx), mm(cy + 1.5));
    } else if (mode === "square") {
      pdf.rect(mm(cx - 3), mm(cy - 3), mm(6), mm(6), "F");
    } else if (qr) {
      pdf.addImage(qr, "PNG", mm(entry.qrAbsoluteXmm), mm(entry.qrAbsoluteYmm),
        mm(entry.qrCenterXmm - entry.qrLeftMm) * 2, mm(entry.qrCenterYmm - entry.qrTopMm) * 2,
        undefined, "FAST");
    }
  }
  return pdf.output("blob");
}




/** 에이전트 실행 여부 확인 (GET /health). */
export async function checkLabelAgent(base?: string): Promise<boolean> {
  return checkPrintAgent(base);
}

/**
 * 라벨들을 한 줄(열 개수)씩 나눠 로컬 에이전트에 순차 전송한다.
 * 프린터가 다이컷 센서로 줄 경계를 잡으므로 인쇄 요청도 한 줄 = 한 페이지로 보낸다.
 */
export async function printLabelsViaAgent(
  t: QrLabelTemplate,
  items: AgentLabelItem[],
  jobId?: string,
): Promise<RawPngPrintResult | null> {
  const capabilities = await getPrintAgentCapabilities();
  const rows = chunkRows(t, items);
  const direct = t.direct_pdf_print !== false;
  let last: RawPngPrintResult | null = null;
  for (let r = 0; r < rows.length; r++) {
    const rowJobId = jobId ? (rows.length > 1 ? `${jobId}-r${r + 1}` : jobId) : undefined;
    if (direct) {
      // 이미지 변환 없이 만든 라벨 문서를 그대로 전송(초기 방식)
      const { wMm, hMm, gapY } = labelPageSizePt(t, rows[r].length);
      await printPdfViaAgent({
        pdf: await buildLabelsPdf(t, rows[r]),
        copies: 1,
        labelWidthMm: wMm,
        labelHeightMm: hMm,
        gapMm: gapY,
        jobId: rowJobId,
        printerName: t.printer_name,
        dpi: t.printer_dpi || t.dpi,
        orientation: wMm > hMm ? "landscape" : "portrait",
      });
      last = null;
      continue;
    }
    const raster = await buildFinalLabelRaster(t, rows[r]);
    if (capabilities.rawPng) {
      last = await printRawPngViaAgent({
        png: raster.png, widthMm: raster.widthMm, heightMm: raster.heightMm,
        dpi: raster.dpi, pixelWidth: raster.pixelWidth, pixelHeight: raster.pixelHeight,
        sha256: raster.sha256, jobId: rowJobId,
      });
    } else {
      await printPdfViaAgent({
        pdf: raster.agentPdf,
        copies: 1,
        labelWidthMm: raster.widthMm,
        labelHeightMm: raster.heightMm,
        gapMm: Math.max(0, Number(t.vertical_gap) || 0),
        jobId: rowJobId,
        printerName: t.printer_name,
        dpi: raster.dpi,
        pixelWidth: raster.pixelWidth,
        pixelHeight: raster.pixelHeight,
        imageFormat: raster.format,
        orientation: raster.widthMm > raster.heightMm ? "landscape" : "portrait",
      });
      last = null;
    }
  }
  return last;
}

/** 진단 출력 — 한 줄(5열) 문서를 rows 번 반복 전송한다. */
export async function printDiagnosticViaAgent(
  t: QrLabelTemplate,
  mode: DiagnosticMode,
  rows = 10,
): Promise<RawPngPrintResult> {
  const raster = await buildFinalDiagnosticRaster(t, mode);
  let last: RawPngPrintResult | null = null;
  for (let r = 0; r < Math.max(1, rows); r++) {
    last = await printRawPngViaAgent({
      png: raster.png, widthMm: raster.widthMm, heightMm: raster.heightMm,
      dpi: raster.dpi, pixelWidth: raster.pixelWidth, pixelHeight: raster.pixelHeight,
      sha256: raster.sha256,
    });
  }
  return last as RawPngPrintResult;
}


