import sharp from "sharp";
import { fetch } from "undici";

const FETCH_TIMEOUT_MS = 60_000;

async function fetchBytes(url: string): Promise<Buffer> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(t);
  }
}

export interface ItemMeta {
  passthrough?: boolean;
  targetW?: number;
  targetH?: number;
  transform?: { offsetXPct?: number; offsetYPct?: number; scale?: number };
  mask?: { url?: string };
  footer?: { text?: string; fontSize?: number; color?: string };
  [k: string]: unknown;
}

/**
 * Process a single design source URL into a final PNG buffer.
 * - meta.passthrough = true → download URL as-is (client already composited the PNG)
 * - otherwise: Lanczos3 resize + optional mask clip + optional footer overlay.
 */
export async function buildItemPng(sourceUrl: string, meta: ItemMeta = {}): Promise<Buffer> {
  if (meta.passthrough) {
    // Client-side already produced the final PNG; just fetch the bytes.
    return await fetchBytes(sourceUrl);
  }

  const targetW = Math.max(64, meta.targetW ?? 2126);
  const targetH = Math.max(64, meta.targetH ?? 2598);

  const srcBytes = await fetchBytes(sourceUrl);
  const baseImg = sharp(srcBytes, { failOnError: false }).rotate();
  const baseMeta = await baseImg.metadata();
  const srcW = baseMeta.width ?? targetW;
  const srcH = baseMeta.height ?? targetH;

  // Fit source into target, then offset/scale per meta.transform
  const scale = meta.transform?.scale ?? 1;
  const fitScale = Math.min(targetW / srcW, targetH / srcH) * scale;
  const resizedW = Math.max(1, Math.round(srcW * fitScale));
  const resizedH = Math.max(1, Math.round(srcH * fitScale));

  const resized = await baseImg
    .resize(resizedW, resizedH, { kernel: sharp.kernel.lanczos3, fit: "fill" })
    .png()
    .toBuffer();

  const offX = Math.round((targetW - resizedW) / 2 + (meta.transform?.offsetXPct ?? 0) * targetW);
  const offY = Math.round((targetH - resizedH) / 2 + (meta.transform?.offsetYPct ?? 0) * targetH);

  let canvas = sharp({
    create: { width: targetW, height: targetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resized, left: offX, top: offY }])
    .png();

  let buf = await canvas.toBuffer();

  // Optional mask: PNG with alpha; we use dest-in (keep pixels where mask is opaque)
  if (meta.mask?.url) {
    try {
      const maskBytes = await fetchBytes(meta.mask.url);
      const maskResized = await sharp(maskBytes, { failOnError: false })
        .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, fit: "fill" })
        .ensureAlpha()
        .png()
        .toBuffer();
      buf = await sharp(buf)
        .composite([{ input: maskResized, blend: "dest-in" }])
        .png()
        .toBuffer();
    } catch (e) {
      console.warn("[sharp] mask failed", (e as Error).message);
    }
  }

  // Optional footer text via SVG overlay
  if (meta.footer?.text) {
    const fontSize = meta.footer.fontSize ?? 36;
    const color = meta.footer.color ?? "#000";
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
         <text x="50%" y="${targetH - 40}" font-family="Arial, sans-serif"
               font-size="${fontSize}" fill="${color}" text-anchor="middle">${escapeXml(meta.footer.text)}</text>
       </svg>`,
    );
    buf = await sharp(buf).composite([{ input: svg }]).png().toBuffer();
  }

  return buf;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] || c));
}
