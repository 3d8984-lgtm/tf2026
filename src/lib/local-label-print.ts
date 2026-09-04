// 이 PC에 (USB 등으로) 직접 연결된 라벨 프린터로 출력한다.
// 네트워크 브리지 없이 브라우저 인쇄 엔진 → Windows 프린터 큐로 바로 보낸다.
// 페이지 크기를 라벨 실측 mm 로 지정하므로 배율 100% 로 출력된다.

import QRCode from "qrcode";
import type { QrLabelTemplate } from "./qr-label-template";

export type LocalLabelItem = { position: number; code: string; edition: string };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function qrDataUrl(value: string, level: QrLabelTemplate["qr_error_level"]) {
  return QRCode.toDataURL(value || " ", { errorCorrectionLevel: level, margin: 0, scale: 8 });
}

export async function buildLabelsHtml(t: QrLabelTemplate, items: LocalLabelItem[]): Promise<string> {
  const qrs = await Promise.all(items.map((i) => qrDataUrl(i.code, t.qr_error_level)));
  const alignTransform =
    t.edition_alignment === "center" ? "translateX(-50%)"
      : t.edition_alignment === "right" ? "translateX(-100%)" : "none";

  const pages = items.map((it, idx) => `
    <div class="label">
      <img class="qr" src="${qrs[idx]}" alt="${esc(it.code)}" />
      <div class="edition">${esc(it.edition)}</div>
    </div>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>QR Label</title>
<style>
  @page { size: ${t.label_width}mm ${t.label_height}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .label {
    position: relative;
    width: ${t.label_width}mm; height: ${t.label_height}mm;
    overflow: hidden; page-break-after: always; break-after: page;
    background: #fff;
  }
  .label:last-child { page-break-after: auto; break-after: auto; }
  .qr {
    position: absolute;
    left: ${t.qr_x}mm; top: ${t.qr_y}mm;
    width: ${t.qr_width}mm; height: ${t.qr_height}mm;
    image-rendering: pixelated;
  }
  .edition {
    position: absolute;
    left: ${t.edition_x}mm; top: ${t.edition_y}mm;
    transform: ${alignTransform};
    font-family: ${t.edition_font_family}, sans-serif;
    font-size: ${t.edition_font_size}pt;
    font-weight: ${t.edition_font_weight === "bold" ? 700 : 400};
    line-height: 1; color: #000; white-space: nowrap;
  }
</style></head><body>${pages}</body></html>`;
}

/**
 * 숨김 iframe 으로 인쇄한다. 브라우저 인쇄 대화상자에서 이 PC에 연결된
 * 라벨 프린터를 선택하면 되고, kiosk-printing 모드에서는 기본 프린터로 즉시 출력된다.
 */
export async function printLabelsLocally(t: QrLabelTemplate, items: LocalLabelItem[]): Promise<void> {
  if (items.length === 0) return;
  const html = await buildLabelsHtml(t, items);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("label render timeout")), 15000);
    iframe.onload = () => { clearTimeout(timer); resolve(); };
    const doc = iframe.contentDocument;
    if (!doc) { clearTimeout(timer); reject(new Error("iframe unavailable")); return; }
    doc.open(); doc.write(html); doc.close();
    // 일부 브라우저는 document.write 후 onload 를 발생시키지 않는다.
    setTimeout(() => { clearTimeout(timer); resolve(); }, 400);
  });

  // 이미지 디코드 완료 대기
  const win = iframe.contentWindow;
  const imgs = Array.from(iframe.contentDocument?.images ?? []);
  await Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = r; im.onerror = r; }))));

  try {
    win?.focus();
    win?.print();
  } finally {
    setTimeout(() => iframe.remove(), 60000);
  }
}
