// Convert text to vector outlines (paths) for PDF — same as Illustrator's "Create Outlines".
// Glyphs become pure vector shapes; no font is embedded in the PDF.
import * as opentype from "opentype.js";
import type { PDFPage, RGB } from "pdf-lib";

const fontCache = new Map<string, opentype.Font>();

export async function loadOpentypeFont(bytes: Uint8Array, cacheKey: string): Promise<opentype.Font> {
  const hit = fontCache.get(cacheKey);
  if (hit) return hit;
  // opentype.parse expects an ArrayBuffer
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const font = opentype.parse(ab);
  fontCache.set(cacheKey, font);
  return font;
}

/**
 * Measure text width in PDF points using opentype metrics
 * (matches what drawTextAsOutline will actually render).
 */
export function measureOutlineWidthPt(font: opentype.Font, text: string, sizePt: number): number {
  return font.getAdvanceWidth(text, sizePt);
}

/** Ascent in PDF points for top-aligned baseline calculation. */
export function outlineAscentPt(font: opentype.Font, sizePt: number): number {
  return (font.ascender / font.unitsPerEm) * sizePt;
}

/**
 * Draw `text` as vector outlines onto a pdf-lib PDFPage.
 * (xPt, baselineYPt) is the baseline origin in PDF coordinates (origin bottom-left).
 */
export function drawTextAsOutline(
  page: PDFPage,
  font: opentype.Font,
  text: string,
  xPt: number,
  baselineYPt: number,
  sizePt: number,
  color: RGB,
): void {
  // opentype's path uses y-down; pdf-lib uses y-up. Flip via page.drawSvgPath transform.
  // getPath returns a path positioned at (x, y) where y is the baseline in y-down space.
  // We render at (0, 0) in y-down, then translate using pdf-lib coordinates.
  const path = font.getPath(text, 0, 0, sizePt);
  const d = path.toPathData(3);
  page.drawSvgPath(d, {
    x: xPt,
    y: baselineYPt,
    color,
    // pdf-lib drawSvgPath does NOT auto-flip Y; opentype path is in y-down with baseline at y=0,
    // so glyphs sit above the baseline at negative y. With y-up, we want them above => no flip needed
    // because negative y in opentype maps to negative y in pdf-lib which we then add baselineYPt to.
    // However pdf-lib draws SVG path with its own Y-down convention by default. Override scale.y = 1
    // is not supported; we must pre-flip the path. Simplest: use scale=1 and rely on pdf-lib's
    // built-in y-flip for drawSvgPath (it flips by default).
    scale: 1,
  });
}
