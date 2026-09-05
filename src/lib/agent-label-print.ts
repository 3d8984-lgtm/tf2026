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
import type { QrLabelTemplate } from "./qr-label-template";
import { checkPrintAgent, printPdfViaAgent } from "./print-agent";

export type AgentLabelItem = { position: number; code: string; edition: string };

const PT_TO_MM = 25.4 / 72;

async function qrDataUrl(value: string, level: QrLabelTemplate["qr_error_level"]) {
  return QRCode.toDataURL(value || " ", { errorCorrectionLevel: level, margin: 0, scale: 10 });
}

/** 라벨 목록을 하나의 다중 페이지 PDF Blob으로 만든다. */
export async function buildLabelsPdf(t: QrLabelTemplate, items: AgentLabelItem[]): Promise<Blob> {
  if (items.length === 0) throw new Error("no labels");
  const w = t.label_width;
  const h = t.label_shape === "round" ? t.label_width : t.label_height;
  const pdf = new jsPDF({
    unit: "mm",
    format: [w, h],
    orientation: w > h ? "landscape" : "portrait",
    compress: true,
  });

  const qrs = await Promise.all(items.map((i) => qrDataUrl(i.code, t.qr_error_level)));

  for (let idx = 0; idx < items.length; idx++) {
    if (idx > 0) pdf.addPage([w, h], w > h ? "landscape" : "portrait");
    const it = items[idx];

    // 흰 배경
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, w, h, "F");

    // QR
    pdf.addImage(qrs[idx], "PNG", t.qr_x, t.qr_y, t.qr_width, t.qr_height, undefined, "FAST");

    // 에디션 텍스트 — HTML 기준 top 좌표를 베이스라인으로 환산
    const style = t.edition_font_weight === "bold" ? "bold" : "normal";
    pdf.setFont("helvetica", style);
    pdf.setFontSize(t.edition_font_size);
    pdf.setTextColor(0, 0, 0);
    const baselineY = t.edition_y + t.edition_font_size * PT_TO_MM;
    const align = t.edition_alignment;
    pdf.text(String(it.edition ?? ""), t.edition_x, baselineY, {
      align: align === "center" ? "center" : align === "right" ? "right" : "left",
      baseline: "alphabetic",
    } as any);
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
 */
export async function printLabelsViaAgent(
  t: QrLabelTemplate,
  items: AgentLabelItem[],
  printerName?: string | null,
): Promise<void> {
  const pdf = await buildLabelsPdf(t, items);
  await printPdfViaAgent({
    pdf,
    printerName: printerName || t.printer_name || undefined,
    copies: 1,
  });
}
