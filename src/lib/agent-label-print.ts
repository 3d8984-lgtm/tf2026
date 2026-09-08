// 로컬 프린트 에이전트(127.0.0.1:9100)로 QR 라벨을 PDF로 전송해 출력한다.
// 에이전트가 PDF 사이즈에 맞춰 프린터 용지를 자동으로 맞춰 인쇄한다.
//
//   건강 확인: GET  http://127.0.0.1:9100/health → { status: "ok" }
//   인쇄:      POST http://127.0.0.1:9100/print  (body = PDF bytes)
//
// 라벨 1장 = PDF 1페이지(라벨 실측 mm)로 구성해 여러 장을 한 PDF로 보낸다.
// QR은 이미지로, 에디션 텍스트는 벡터 텍스트로 그려 화질 저하가 없다.

import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { resolveCenterBox, centerFontPt, type QrLabelTemplate } from "./qr-label-template";
import { checkPrintAgent, printPdfViaAgent } from "./print-agent";

export type AgentLabelItem = { position: number; code: string; edition: string };

const PT_PER_MM = 72 / 25.4;
const mm = (v: number) => v * PT_PER_MM;

async function qrDataUrl(value: string, level: QrLabelTemplate["qr_error_level"]) {
  return QRCode.toDataURL(value || " ", { errorCorrectionLevel: level, margin: 0, scale: 10 });
}

/**
 * 실제 인쇄 페이지 크기(mm/pt).
 * 용지 한 줄에 columns 개의 라벨이 들어가므로
 * 폭 = 좌여백 + 라벨폭*열 + 간격*(열-1) + 우여백 이다.
 */
export function labelPageSizePt(t: QrLabelTemplate) {
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
  const hMm = mt + cellH + gapY + mb;
  return { wMm, hMm, w: mm(wMm), h: mm(hMm), cols, cellW, cellH, gapX, ml, mt };
}

/**
 * 라벨 목록을 하나의 다중 페이지 PDF Blob으로 만든다.
 * 한 페이지 = 용지 한 줄(열 개수만큼의 라벨 칸)이며 각 칸에 QR을 정중앙 배치한다.
 */
export async function buildLabelsPdf(t: QrLabelTemplate, items: AgentLabelItem[]): Promise<Blob> {
  if (items.length === 0) throw new Error("no labels");
  const { w, h, cols, cellW, cellH, gapX, ml, mt } = labelPageSizePt(t);
  const orientation = w > h ? "landscape" : "portrait";
  const pdf = new jsPDF({ unit: "pt", format: [w, h], orientation, compress: true });

  const qrs = await Promise.all(items.map((i) => qrDataUrl(i.code, t.qr_error_level)));

  // QR 크기는 라벨 칸을 넘지 않도록 제한하고, 설정된 X/Y를 각 칸 기준으로 적용한다.
  const quiet = Math.max(0, Number(t.qr_quiet_zone) || 0);
  const qw = Math.min(Math.max(1, Number(t.qr_width) || 1), Math.max(1, cellW - quiet * 2));
  const qh = Math.min(Math.max(1, Number(t.qr_height) || 1), Math.max(1, cellH - quiet * 2));
  // qr_x/qr_y = QR 중심점 — 칸 안에 유지되도록 중심 범위를 제한한 뒤 좌상단으로 환산
  const centerX = Math.min(Math.max(qw / 2, Number(t.qr_x) || 0), Math.max(qw / 2, cellW - qw / 2));
  const centerY = Math.min(Math.max(qh / 2, Number(t.qr_y) || 0), Math.max(qh / 2, cellH - qh / 2));
  const qrLocalX = centerX - qw / 2;
  const qrLocalY = centerY - qh / 2;
  const centerT = { ...t, qr_x: centerX, qr_y: centerY, qr_width: qw, qr_height: qh };

  for (let idx = 0; idx < items.length; idx++) {
    const col = idx % cols;
    if (idx > 0 && col === 0) pdf.addPage([w, h], orientation);
    if (idx === 0 || col === 0) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, w, h, "F");
    }
    const it = items[idx];
    const ox = ml + col * (cellW + gapX);
    const oy = mt;

    // QR (각 칸 내부에서 라벨 설정의 X/Y 위치)
    pdf.addImage(
      qrs[idx], "PNG",
      mm(ox + qrLocalX), mm(oy + qrLocalY), mm(qw), mm(qh),
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
): Promise<void> {
  const pdf = await buildLabelsPdf(t, items);
  const { wMm, hMm } = labelPageSizePt(t);
  await printPdfViaAgent({
    pdf,
    copies: 1,
    labelWidthMm: wMm,
    labelHeightMm: hMm,
  });
}
