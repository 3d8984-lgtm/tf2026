// Post-processes a carrier-issued waybill PDF before it is sent to the printer.
//
// Why this exists:
//  1) 4PX returns the channel label on a square page (≈94×94 mm), not on the
//     100×150 mm media we print on. Printer drivers then "fit to page", which
//     stretches/re-samples the page and makes the small address text look fuzzy.
//     Here the original page is embedded UNCHANGED (vector, 100 % scale) onto a
//     real 100×150 mm page, so the driver has nothing left to scale.
//  2) The "Ref No" box on the 4PX/Postlink template is printed empty — the
//     channel label does not echo the ref_no we sent with ds.xms.order.create.
//     We stamp it ourselves in the same spot.
//
// Everything stays vector: no html2canvas / no raster conversion.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const MM = 72 / 25.4;

export interface FinishLabelOpts {
  /** Target media size in mm (default 100×150). */
  widthMm?: number;
  heightMm?: number;
  /** Text stamped into the "Ref No:" box (brand + english item name). */
  refNo?: string | null;
}

/**
 * Returns a new PDF Blob sized exactly to the label media with the Ref No filled in.
 * Falls back to the original blob when anything goes wrong.
 */
export async function finishLabelPdf(pdf: Blob, opts: FinishLabelOpts = {}): Promise<Blob> {
  const widthMm = opts.widthMm ?? 100;
  const heightMm = opts.heightMm ?? 150;
  const pageW = widthMm * MM;
  const pageH = heightMm * MM;

  try {
    const srcBytes = new Uint8Array(await pdf.arrayBuffer());
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const [srcPage] = src.getPages();
    if (!srcPage) return pdf;
    const { width: sw, height: sh } = srcPage.getSize();

    // Already the right media and nothing to stamp → keep the original bytes.
    const sameSize = Math.abs(sw - pageW) < 2 && Math.abs(sh - pageH) < 2;
    if (sameSize && !opts.refNo) return pdf;

    const out = await PDFDocument.create();
    const embedded = await out.embedPage(srcPage);
    const page = out.addPage([pageW, pageH]);

    // Fit by width, never enlarge past the media; anchor to the top edge.
    const scale = Math.min(pageW / sw, pageH / sh);
    const drawW = sw * scale;
    const drawH = sh * scale;
    const offX = (pageW - drawW) / 2;
    const offY = pageH - drawH;
    page.drawPage(embedded, { x: offX, y: offY, width: drawW, height: drawH });

    if (opts.refNo) {
      const font = await out.embedFont(StandardFonts.HelveticaBold);
      // "Ref No:" sits ~48.5 pt above the bottom of the original 4PX page.
      const size = 10;
      const x = offX + 46 * scale;
      const y = offY + 47 * scale;
      const text = opts.refNo.replace(/[^\x20-\x7E]/g, "").slice(0, 40);
      page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
    }

    const bytes = await out.save();
    return new Blob([bytes], { type: "application/pdf" });
  } catch {
    return pdf;
  }
}
