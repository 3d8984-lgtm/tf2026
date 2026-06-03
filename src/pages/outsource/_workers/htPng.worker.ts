/// <reference lib="webworker" />
// Heat-transfer PNG builder worker.
// Runs OffscreenCanvas compositing off the main thread so 발주 PNG 생성이
// UI를 막지 않고 여러 코어에서 동시에 진행된다.
import QRCode from "qrcode";

export interface FooterCfg {
  enabled: boolean;
  qrSizeMm: number;
  textSizeMm: number;
  offsetXPct: number;
  bottomPaddingMm: number;
  gapMm: number;
}

interface BuildMsg {
  type: "build";
  idx: number;
  designUid: string;
  designSrc: string;
  maskKey: string;
  maskBlob: Blob;
  targetW: number;
  targetH: number;
  widthPt: number;
  dpi: number;
  transform: { offsetXPct: number; offsetYPct: number; scale: number };
  footer: FooterCfg;
  meta: { tshirtType?: string; tshirtColor?: string; tshirtSize?: string };
  useOriginal?: boolean;
}

type InMsg = BuildMsg | { type: "drop-mask"; maskKey: string };

const maskCache = new Map<string, Promise<ImageBitmap>>();
const imgCache = new Map<string, Promise<ImageBitmap>>();

function getMask(key: string, blob: Blob): Promise<ImageBitmap> {
  let p = maskCache.get(key);
  if (!p) {
    p = createImageBitmap(blob);
    maskCache.set(key, p);
  }
  return p;
}

function getImg(src: string): Promise<ImageBitmap> {
  let p = imgCache.get(src);
  if (!p) {
    p = (async () => {
      const res = await fetch(src, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(`디자인 fetch 실패 ${res.status}`);
      const blob = await res.blob();
      return await createImageBitmap(blob);
    })();
    imgCache.set(src, p);
  }
  return p;
}

// CRC32 + pHYs injection (mirrors main-thread pngWithDpi).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function injectDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLen = dv.getUint32(8);
  const ihdrEnd = 8 + 4 + 4 + ihdrLen + 4;
  const ppm = Math.round(dpi / 0.0254);
  const chunkData = new Uint8Array(9);
  const cdv = new DataView(chunkData.buffer);
  cdv.setUint32(0, ppm);
  cdv.setUint32(4, ppm);
  chunkData[8] = 1;
  const type = new Uint8Array([0x70, 0x48, 0x59, 0x73]);
  const crcInput = new Uint8Array(type.length + chunkData.length);
  crcInput.set(type, 0); crcInput.set(chunkData, type.length);
  const crc = crc32(crcInput);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const xdv = new DataView(chunk.buffer);
  xdv.setUint32(0, 9);
  chunk.set(type, 4);
  chunk.set(chunkData, 8);
  xdv.setUint32(17, crc);
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

function drawQr(ctx: OffscreenCanvasRenderingContext2D, text: string, x: number, y: number, sizePx: number) {
  // DOM/canvas helpers in qrcode can fail inside module workers. Use the pure
  // matrix API and draw directly on OffscreenCanvas instead.
  const qr = QRCode.create(text || " ", { errorCorrectionLevel: "M" });
  const modules = qr.modules;
  const count = modules.size;
  const cell = sizePx / count;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, sizePx, sizePx);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!modules.get(row, col)) continue;
      ctx.fillRect(
        x + Math.floor(col * cell),
        y + Math.floor(row * cell),
        Math.ceil(cell),
        Math.ceil(cell),
      );
    }
  }
}

async function compose(msg: BuildMsg): Promise<Uint8Array> {
  const mask = await getMask(msg.maskKey, msg.maskBlob);
  const img = await getImg(msg.designSrc);

  const { transform, footer, dpi, widthPt, designUid, meta, useOriginal } = msg;
  // useOriginal: image is already at print pixel size — output canvas matches image.
  const targetW = useOriginal ? img.width : msg.targetW;
  const targetH = useOriginal ? img.height : msg.targetH;

  // 1) clipped design canvas
  const base = new OffscreenCanvas(targetW, targetH);
  const bctx = base.getContext("2d")!;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";

  const userScale = transform.scale ?? 1;
  const baseScale = useOriginal ? 1 : Math.max(targetW / img.width, targetH / img.height);
  const scale = baseScale * userScale;
  const dw = Math.max(1, Math.round(img.width * scale));
  const dh = Math.max(1, Math.round(img.height * scale));
  const dx = Math.round((targetW - dw) / 2 + ((transform.offsetXPct ?? 0) / 100) * targetW);
  const dy = Math.round((targetH - dh) / 2 + ((transform.offsetYPct ?? 0) / 100) * targetH);
  bctx.drawImage(img, dx, dy, dw, dh);
  bctx.globalCompositeOperation = "destination-in";
  bctx.drawImage(mask, 0, 0, targetW, targetH);
  bctx.globalCompositeOperation = "source-over";

  // 2) footer band
  let finalCanvas: OffscreenCanvas = base;
  if (footer.enabled) {
    const widthMm = (widthPt / 72) * 25.4;
    const pxPerMm = base.width / widthMm;
    const qrPx = Math.max(1, Math.round(footer.qrSizeMm * pxPerMm));
    const textPx = Math.max(1, Math.round(footer.textSizeMm * pxPerMm));
    const gapPx = Math.max(0, Math.round(footer.gapMm * pxPerMm));
    const padPx = Math.max(0, Math.round(footer.bottomPaddingMm * pxPerMm));
    const metaParts = [meta.tshirtType, meta.tshirtColor, meta.tshirtSize]
      .map((v) => (v ?? "").toString().trim()).filter(Boolean);
    const metaText = metaParts.join(" · ");
    const metaTextPx = Math.max(1, Math.round(footer.textSizeMm * 0.85 * pxPerMm));
    const bandH = Math.max(qrPx, textPx, metaText ? metaTextPx : 0) + padPx * 2;

    const out = new OffscreenCanvas(base.width, base.height + bandH);
    const ctx = out.getContext("2d")!;
    ctx.clearRect(0, 0, out.width, out.height);
    ctx.drawImage(base, 0, 0);

    ctx.fillStyle = "#000000";
    ctx.font = `${textPx}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textBaseline = "middle";
    const textW = Math.ceil(ctx.measureText(designUid || "").width);
    const groupW = qrPx + gapPx + textW;
    const freeX = Math.max(0, out.width - groupW);
    const t = (footer.offsetXPct + 100) / 200;
    const groupX = Math.round(freeX * t);
    const bandTop = base.height + padPx;
    const groupCenterY = bandTop + Math.max(qrPx, textPx) / 2;

    drawQr(ctx, designUid, groupX, Math.round(groupCenterY - qrPx / 2), qrPx);
    ctx.fillText(designUid || "", groupX + qrPx + gapPx, groupCenterY);
    if (metaText) {
      ctx.font = `${metaTextPx}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
      ctx.textBaseline = "middle";
      const metaX = groupX + qrPx + gapPx + textW + gapPx;
      ctx.fillText(metaText, metaX, groupCenterY);
    }
    finalCanvas = out;
  }

  // 3) encode + DPI metadata
  const pngBlob = await finalCanvas.convertToBlob({ type: "image/png" });
  const raw = new Uint8Array(await pngBlob.arrayBuffer());
  return injectDpi(raw, dpi);
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === "drop-mask") {
    const cached = maskCache.get(msg.maskKey);
    if (cached) { cached.then((b) => b.close()).catch(() => {}); maskCache.delete(msg.maskKey); }
    return;
  }
  if (msg.type !== "build") return;
  try {
    const bytes = await compose(msg);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage(
      { type: "done", idx: msg.idx, designUid: msg.designUid, buffer: buf },
      [buf],
    );
  } catch (err: unknown) {
    self.postMessage({
      type: "error", idx: msg.idx, designUid: msg.designUid,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
