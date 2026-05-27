// Convert an SVG string into a single-page PDF (vector) and return its bytes.
// Uses jsPDF + svg2pdf.js. The resulting bytes can be embedded into a master
// pdf-lib document via PDFDocument.embedPdf().
import { jsPDF } from "jspdf";
import "svg2pdf.js";

/**
 * Render the given SVG string into a 1-page vector PDF sized exactly widthPt x heightPt.
 * The SVG is drawn to fill the entire page (svg2pdf maps its viewBox into the given box).
 */
export async function svgStringToPdfBytes(
  svgString: string,
  widthPt: number,
  heightPt: number,
): Promise<Uint8Array> {
  const doc = new jsPDF({
    unit: "pt",
    format: [widthPt, heightPt],
    orientation: widthPt > heightPt ? "landscape" : "portrait",
  });
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = svgDoc.documentElement as unknown as SVGSVGElement;
  // Force viewBox if missing (bwip-js SVG always sets one; twincode SVGs may vary)
  if (!svgEl.getAttribute("viewBox")) {
    const w = Number(svgEl.getAttribute("width")) || 100;
    const h = Number(svgEl.getAttribute("height")) || 100;
    svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  await (doc as any).svg(svgEl, { x: 0, y: 0, width: widthPt, height: heightPt });
  return new Uint8Array(doc.output("arraybuffer"));
}

/**
 * Best-effort fetch of a remote SVG file as a string. Strips XML BOM if present.
 */
export async function fetchSvgString(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`SVG fetch failed: ${res.status}`);
  const text = await res.text();
  return text.replace(/^\uFEFF/, "");
}

/**
 * Read an SVG's intrinsic aspect ratio (width/height) from viewBox or attributes.
 * Returns 1 when unknown.
 */
export function svgAspectRatio(svgString: string): number {
  const m = svgString.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (m) {
    const parts = m[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return parts[2] / parts[3];
  }
  const wm = svgString.match(/\bwidth\s*=\s*"([\d.]+)/i);
  const hm = svgString.match(/\bheight\s*=\s*"([\d.]+)/i);
  if (wm && hm) {
    const w = Number(wm[1]); const h = Number(hm[1]);
    if (w > 0 && h > 0) return w / h;
  }
  return 1;
}
