import { describe, expect, it } from "vitest";
import { createLabelDocumentLayout, labelPageSizePt } from "./agent-label-print";
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

describe("continuous QR label print layout", () => {
  it("uses 83mm width and 17mm row pitch", () => {
    const size = labelPageSizePt(template, 50);
    expect(size.wMm).toBe(83);
    expect(size.hMm).toBe(170);
    expect(size.verticalPitchMm).toBe(17);
  });

  it("increments absolute row Y and QR top by the vertical pitch", () => {
    const layout = createLabelDocumentLayout(template, 20);
    expect(layout.entries.filter((entry) => entry.column === 0).map((entry) => entry.labelYmm)).toEqual([0, 17, 34, 51]);
    expect(layout.entries.filter((entry) => entry.column === 0).map((entry) => entry.qrAbsoluteYmm)).toEqual([2.6, 19.6, 36.6, 53.6]);
  });

  it("creates exactly one unique layout entry per item", () => {
    const layout = createLabelDocumentLayout(template, 50);
    expect(layout.entries).toHaveLength(50);
    expect(new Set(layout.entries.map((entry) => entry.itemIndex)).size).toBe(50);
  });
});