import { describe, expect, it } from "vitest";
import { createLabelDocumentLayout, labelPageSizePt } from "./agent-label-print";
import { mmToPixels } from "./final-label-raster";
import { QR_LABEL_DEFAULTS } from "./qr-label-template";

const template = {
  ...QR_LABEL_DEFAULTS,
  label_shape: "round" as const,
  label_width: 15,
  label_height: 15,
  columns: 5,
  horizontal_gap: 2,
  vertical_gap: 2,
  margin_top: 0,
  margin_bottom: 0,
  margin_left: 0,
  margin_right: 0,
  qr_x: 7.5,
  qr_y: 7.5,
  qr_width: 9.8,
  qr_height: 9.8,
  qr_quiet_zone: 0,
};

describe("one-row-per-page QR label print layout", () => {
  it("uses 83mm width and a single 15mm row height", () => {
    const size = labelPageSizePt(template, 50);
    expect(size.wMm).toBe(83);
    expect(size.hMm).toBe(15);
    expect(size.verticalPitchMm).toBe(15);
    expect(mmToPixels(size.wMm, 300)).toBe(980);
    expect(mmToPixels(size.hMm, 300)).toBe(177);
  });

  it("places every row at page-local Y = 0", () => {
    const layout = createLabelDocumentLayout(template, 20);
    expect(layout.entries.filter((entry) => entry.column === 0).map((entry) => entry.labelYmm)).toEqual([0, 0, 0, 0]);
    expect(layout.entries.filter((entry) => entry.column === 0).map((entry) => entry.qrAbsoluteYmm)).toEqual([2.6, 2.6, 2.6, 2.6]);
  });

  it("creates exactly one unique layout entry per item", () => {
    const layout = createLabelDocumentLayout(template, 50);
    expect(layout.entries).toHaveLength(50);
    expect(new Set(layout.entries.map((entry) => entry.itemIndex)).size).toBe(50);
  });
});
