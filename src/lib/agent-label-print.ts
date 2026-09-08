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
import { resolveCenterBox, centerFontPt, type QrLabelTemplate } from "./qr-label-template";
import { checkPrintAgent, printPdfViaAgent } from "./print-agent";
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
 * 용지 한 줄에 columns 개의 라벨이 들어가므로
 * 폭 = 좌여백 + 라벨폭*열 + 간격*(열-1) + 우여백 이다.
 */
export function labelPageSizePt(t: QrLabelTemplate, itemCount = Math.max(1, Math.round(Number(t.columns) || 1))) {
  const cols = Math.max(1, Math.round(Number(t.columns) || 1));
  const cellW = Math.max(1, Number(t.label_width) || 0);
  const cellH = t.label_shape === "round" ? cellW : Math.max(1, Number(t.label_height) || 0);
  const gapX = Math.max(0, Number(t.horizontal_gap) || 0);
  const gapY = Math.max(0, Number(t.vertical_gap) || 0);
  const ml = Math.max(0, Number(t.margin_left) || 0);
  const mr = Math.max(0, Number(t.margin_right) || 0);
  const mt = Math.max(0, Number(t.margin_top) || 0);
  const mb = Math.max(0, Number(t.margin_bottom) || 0);
  const wMm = ml + cellW * cols + gapX * (cols - 1) + mr;
  // 라벨 한 장 급지 피치 = 라벨 높이 + 세로 간격. 세로 간격을 빼먹으면
  // 프린터가 피치보다 짧게 급지하여 줄마다 간격만큼 위로 밀려 잘린다.
  const rows = Math.max(1, Math.ceil(Math.max(1, itemCount) / cols));
  const horizontalPitchMm = cellW + gapX;
  const verticalPitchMm = cellH + gapY;
  // 행 시작점은 verticalPitch로 증가하되 마지막 행 뒤에는 간격이 없다.
  const hMm = mt + rows * cellH + Math.max(0, rows - 1) * gapY + mb;
  return {
    wMm, hMm, w: mm(wMm), h: mm(hMm), rows, cols, cellW, cellH,
    gapX, gapY, ml, mr, mt, mb, horizontalPitchMm, verticalPitchMm,
  };
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
    const labelYmm = roundMm(size.mt + row * size.verticalPitchMm);
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
 * 라벨 목록을 하나의 연속 롤 PDF Blob으로 만든다.
 * 모든 행이 같은 페이지에서 row × verticalPitch 절대 좌표를 사용한다.
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

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const entry = layout.entries[idx];
    if (!entry) throw new Error(`missing print layout for item ${idx}`);
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

    if (t.edition_placement === "qr_center") {
      // QR 중앙 삽입 — 흰 박스(오류정정 허용 범위 내) 위에 텍스트를 중앙 정렬
      const box = resolveCenterBox(centerT);
      const fs = centerFontPt(t, box, text);
      pdf.setFillColor(255, 255, 255);
      pdf.rect(mm(ox + box.x), mm(oy + box.y), mm(box.w), mm(box.h), "F");
      pdf.setFontSize(fs);
      pdf.text(text, mm(ox + box.x + box.w / 2), mm(oy + box.y + box.h / 2), {
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

/** 화면 확인·PNG 다운로드·Agent 출력이 함께 사용하는 최종 래스터 결과. */
export async function buildFinalLabelRaster(t: QrLabelTemplate, items: AgentLabelItem[]): Promise<FinalLabelRaster> {
  const sourcePdf = await buildLabelsPdf(t, items);
  const { wMm, hMm } = labelPageSizePt(t, items.length);
  return rasterizePrintPdf(sourcePdf, wMm, hMm, t.printer_dpi || t.dpi);
}

/** 5열×10행 좌표 진단 문서. 실제 라벨과 같은 연속 행 좌표계를 사용한다. */
export async function buildDiagnosticPdf(t: QrLabelTemplate, mode: DiagnosticMode): Promise<Blob> {
  const diagnosticTemplate = { ...t, columns: 5 };
  const count = 50;
  const size = labelPageSizePt(diagnosticTemplate, count);
  const layout = createLabelDocumentLayout(diagnosticTemplate, count);
  assertLayout(layout, count);
  logPrintDebug(layout, mode);
  const orientation = size.w > size.h ? "landscape" : "portrait";
  const pdf = new jsPDF({ unit: "pt", format: [size.w, size.h], orientation, compress: true });
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, size.w, size.h, "F");

  const qr = mode === "qr" ? await qrDataUrl("QR-POSITION-TEST", t.qr_error_level) : null;
  for (const entry of layout.entries) {
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
 * 라벨들을 PDF로 만들어 로컬 에이전트에 전송한다.
 * 실패 시 예외를 던지므로 호출부에서 처리한다.
 * API 기준: printerName 은 에이전트가 무시하고 항상 트레이에서 선택한 프린터로 출력한다.
 * 용지 크기는 labelWidthMm/labelHeightMm(라벨 실물 크기)을 함께 보내
 * 에이전트가 PDF 크기 추정 없이 라벨 규격에 정확히 맞춰 출력하도록 한다.
 */
export async function printLabelsViaAgent(
  t: QrLabelTemplate,
  items: AgentLabelItem[],
  jobId?: string,
): Promise<void> {
  const raster = await buildFinalLabelRaster(t, items);
  await printPdfViaAgent({
    pdf: raster.agentPdf,
    copies: 1,
    labelWidthMm: raster.widthMm,
    labelHeightMm: raster.heightMm,
    jobId,
    printerName: t.printer_name,
    dpi: raster.dpi,
    pixelWidth: raster.pixelWidth,
    pixelHeight: raster.pixelHeight,
    imageFormat: raster.format,
    orientation: raster.widthMm > raster.heightMm ? "landscape" : "portrait",
  });
}

export async function printDiagnosticViaAgent(t: QrLabelTemplate, mode: DiagnosticMode): Promise<void> {
  const diagnosticTemplate = { ...t, columns: 5 };
  const pdf = await buildDiagnosticPdf(diagnosticTemplate, mode);
  const { wMm, hMm } = labelPageSizePt(diagnosticTemplate, 50);
  await printPdfViaAgent({ pdf, copies: 1, labelWidthMm: wMm, labelHeightMm: hMm });
}
