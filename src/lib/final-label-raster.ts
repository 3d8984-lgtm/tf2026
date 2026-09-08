import { jsPDF } from "jspdf";

export type FinalLabelRaster = {
  png: Blob;
  agentPdf: Blob;
  widthMm: number;
  heightMm: number;
  pixelWidth: number;
  pixelHeight: number;
  dpi: number;
  format: "PNG";
};

export const mmToPixels = (valueMm: number, dpi: number) =>
  Math.max(1, Math.round((valueMm / 25.4) * dpi));

const canvasToPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 생성 실패")), "image/png");
});

/** 프린터 실측 보정 — 인쇄물 전체 이동(mm)과 배율(%) */
export type PrintCalibration = {
  offsetXmm?: number;
  offsetYmm?: number;
  scaleXPercent?: number;
  scaleYPercent?: number;
};

/** PDF 첫 페이지를 지정된 실제 mm/DPI의 정확한 픽셀 크기로 렌더한다. */
export async function rasterizePrintPdf(
  sourcePdf: Blob,
  widthMm: number,
  heightMm: number,
  dpi: number,
  calibration: PrintCalibration = {},
): Promise<FinalLabelRaster> {
  const [pdfjsLib, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?worker"),
  ]);
  (pdfjsLib as any).GlobalWorkerOptions.workerPort ??= new workerModule.default();
  const safeDpi = Math.max(72, Math.round(Number(dpi) || 203));
  const pixelWidth = mmToPixels(widthMm, safeDpi);
  const pixelHeight = mmToPixels(heightMm, safeDpi);
  // 보정값: 프린터가 늘리거나 밀어서 찍는 만큼 인쇄물 쪽에서 미리 반대로 보정한다.
  const sx = Math.min(2, Math.max(0.5, (Number(calibration.scaleXPercent) || 100) / 100));
  const sy = Math.min(2, Math.max(0.5, (Number(calibration.scaleYPercent) || 100) / 100));
  const dx = ((Number(calibration.offsetXmm) || 0) / 25.4) * safeDpi;
  const dy = ((Number(calibration.offsetYmm) || 0) / 25.4) * safeDpi;
  const bytes = new Uint8Array(await sourcePdf.arrayBuffer());
  const document = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
  try {
    if (document.numPages !== 1) throw new Error(`최종 출력 PDF가 ${document.numPages}페이지입니다. 단일 페이지여야 합니다.`);
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = window.document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas를 사용할 수 없습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    await page.render({
      canvasContext: context,
      viewport,
      canvas,
      transform: [
        (pixelWidth / viewport.width) * sx, 0,
        0, (pixelHeight / viewport.height) * sy,
        dx, dy,
      ],
      background: "#ffffff",
    } as any).promise;

    const png = await canvasToPng(canvas);

    // Agent에는 이 PNG 한 장만 들어 있는, 실제 mm와 동일한 단일 페이지 PDF를 보낸다.
    const orientation = widthMm > heightMm ? "landscape" : "portrait";
    const output = new jsPDF({ unit: "mm", format: [widthMm, heightMm], orientation, compress: false });
    const dataUrl = canvas.toDataURL("image/png");
    output.addImage(dataUrl, "PNG", 0, 0, widthMm, heightMm, undefined, "NONE");
    return {
      png,
      agentPdf: output.output("blob"),
      widthMm,
      heightMm,
      pixelWidth,
      pixelHeight,
      dpi: safeDpi,
      format: "PNG",
    };
  } finally {
    await document.destroy();
  }
}