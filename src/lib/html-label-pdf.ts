// Converts a locally built label (HTML string, mm-sized) into a real PDF Blob so
// it can be sent to the local printer agent, which only accepts PDF bytes/URLs.
//
// The HTML is rendered inside an offscreen iframe (isolated styles), captured by
// html2canvas at high scale, and placed into a jsPDF page of the exact label size
// with zero margin. Used for test/simulated labels; carrier-issued waybills are
// already PDFs and are forwarded untouched.

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const MM_PER_PX = 25.4 / 96;

export async function htmlLabelToPdfBlob(
  html: string,
  widthMm: number,
  heightMm: number,
  opts: { scale?: number } = {},
): Promise<Blob> {
  const scale = opts.scale ?? 4; // ~384 dpi capture
  const wPx = Math.round(widthMm / MM_PER_PX);
  const hPx = Math.round(heightMm / MM_PER_PX);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;border:0;width:${wPx}px;height:${hPx}px;`;
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("iframe document unavailable");
    // Strip any auto-print script from the source HTML.
    doc.open();
    doc.write(html.replace(/<script[\s\S]*?<\/script>/gi, ""));
    doc.close();

    // Wait for layout + webfonts/images inside the iframe.
    await new Promise<void>((resolve) => {
      if (doc.readyState === "complete") return resolve();
      iframe.onload = () => resolve();
      setTimeout(resolve, 1200);
    });
    await (doc as any).fonts?.ready?.catch?.(() => {});
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; }),
      ),
    );
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const canvas = await html2canvas(doc.body, {
      scale,
      width: wPx,
      height: hPx,
      windowWidth: wPx,
      windowHeight: hPx,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({
      unit: "mm",
      format: [widthMm, heightMm],
      orientation: widthMm > heightMm ? "landscape" : "portrait",
      compress: true,
    });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, widthMm, heightMm, undefined, "FAST");
    return pdf.output("blob");
  } finally {
    iframe.remove();
  }
}
