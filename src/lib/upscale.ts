/**
 * Smart upscaling utility for the outsource factory pages.
 *
 * Replaces the previous per-page `edgePreservingUpscale` (iterative bilinear +
 * 3x3 box-blur unsharp) with a one-shot Lanczos3 resample plus a per-image-type
 * processing pipeline derived from the upscaling decision matrix:
 *
 *   pixel_art      → Nearest-Neighbor integer scale
 *   line_art_logo  → Lanczos3 + strong Gaussian unsharp + alpha re-binarisation
 *   document_text  → Lanczos3 + strong unsharp + alpha re-binarisation
 *   illustration   → Lanczos3 + chroma smoothing + medium unsharp
 *   photo          → Lanczos3 + light unsharp with noise threshold
 *
 * No external dependencies, fully synchronous, never invents detail.
 */

export type ImageKind =
  | "pixel_art"
  | "line_art_logo"
  | "document_text"
  | "illustration"
  | "photo";

export interface ImageAnalysis {
  kind: ImageKind;
  width: number;
  height: number;
  transparent: boolean;
  binaryAlpha: boolean;
  uniqueColors: number;
  edginess: number;
  noise: number;
}

export type UpscaleMode = "auto" | "logo" | "text" | "illustration" | "photo" | "pixel";

export interface SmartUpscaleOptions {
  mode?: UpscaleMode;
  /** 0..100; biases per-type sharpening amount. Default 50. */
  sharpness?: number;
}

export interface SmartUpscaleResult {
  canvas: HTMLCanvasElement;
  analysis: ImageAnalysis;
  method: string;
}

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

function srcDims(img: HTMLImageElement | HTMLCanvasElement): { w: number; h: number } {
  const w = (img as HTMLImageElement).naturalWidth ?? (img as HTMLCanvasElement).width;
  const h = (img as HTMLImageElement).naturalHeight ?? (img as HTMLCanvasElement).height;
  return { w, h };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toCanvas(img: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
  const { w, h } = srcDims(img);
  if ((img as HTMLCanvasElement).getContext) return img as HTMLCanvasElement;
  const c = makeCanvas(w, h);
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img as CanvasImageSource, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Image analysis
// ---------------------------------------------------------------------------

export function analyzeImage(img: HTMLImageElement | HTMLCanvasElement): ImageAnalysis {
  const { w, h } = srcDims(img);
  // Downsample to ~96px on the long side for fast inspection.
  const longSide = Math.max(w, h);
  const k = longSide > 96 ? 96 / longSide : 1;
  const sw = Math.max(8, Math.round(w * k));
  const sh = Math.max(8, Math.round(h * k));
  const c = makeCanvas(sw, sh);
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(img as CanvasImageSource, 0, 0, sw, sh);
  let d: Uint8ClampedArray;
  try {
    d = cx.getImageData(0, 0, sw, sh).data;
  } catch {
    return {
      kind: "photo",
      width: w,
      height: h,
      transparent: false,
      binaryAlpha: false,
      uniqueColors: 0,
      edginess: 0,
      noise: 0,
    };
  }

  // Alpha statistics
  let aZero = 0;
  let aFull = 0;
  let aMid = 0;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    if (a === 0) aZero++;
    else if (a === 255) aFull++;
    else if (a > 24 && a < 232) aMid++;
  }
  const N = sw * sh;
  const transparent = aZero / N > 0.02;
  const binaryAlpha = transparent && aMid / N < 0.04;

  // Unique-color estimate (5-bit quantize per channel → 32^3 cells).
  const seen = new Uint8Array(32 * 32 * 32);
  let unique = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 16) continue;
    const r = d[i] >> 3;
    const g = d[i + 1] >> 3;
    const b = d[i + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    if (!seen[key]) {
      seen[key] = 1;
      unique++;
    }
  }

  // Edginess (Sobel on luminance) + noise (high-frequency variance proxy).
  const lum = new Float32Array(sw * sh);
  for (let i = 0, p = 0; p < d.length; p += 4, i++) {
    lum[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  let edgeSum = 0;
  let edgeCount = 0;
  let noiseSum = 0;
  let noiseCount = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const gx =
        -lum[i - sw - 1] + lum[i - sw + 1] -
        2 * lum[i - 1] + 2 * lum[i + 1] -
        lum[i + sw - 1] + lum[i + sw + 1];
      const gy =
        -lum[i - sw - 1] - 2 * lum[i - sw] - lum[i - sw + 1] +
        lum[i + sw - 1] + 2 * lum[i + sw] + lum[i + sw + 1];
      const mag = Math.abs(gx) + Math.abs(gy);
      edgeSum += mag;
      edgeCount++;
      // High-pass residual: pixel minus 4-neighbour mean
      const mean = (lum[i - 1] + lum[i + 1] + lum[i - sw] + lum[i + sw]) * 0.25;
      const diff = lum[i] - mean;
      noiseSum += diff * diff;
      noiseCount++;
    }
  }
  const edginess = edgeCount ? edgeSum / edgeCount : 0; // 0..~1000
  const noise = noiseCount ? Math.sqrt(noiseSum / noiseCount) : 0; // 0..~80

  // Classification
  let kind: ImageKind;
  if (longSide <= 96 && unique <= 32 && edginess > 80) {
    kind = "pixel_art";
  } else if (transparent && unique <= 256 && edginess > 60) {
    kind = "line_art_logo";
  } else if (unique <= 96 && edginess > 90 && noise < 6) {
    // Dense black-on-white / few colours → document or screenshot of text.
    kind = "document_text";
  } else if (unique <= 4096 && edginess > 40 && noise < 8) {
    kind = "illustration";
  } else {
    kind = "photo";
  }

  return {
    kind,
    width: w,
    height: h,
    transparent,
    binaryAlpha,
    uniqueColors: unique,
    edginess,
    noise,
  };
}

// ---------------------------------------------------------------------------
// Lanczos3 resampling (separable, alpha-aware)
// ---------------------------------------------------------------------------

function lanczosKernel(x: number, a: number): number {
  if (x === 0) return 1;
  if (x <= -a || x >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

function buildLanczosWeights(srcLen: number, dstLen: number, a: number) {
  const scale = dstLen / srcLen;
  const support = scale < 1 ? a / scale : a; // anti-alias when downscaling
  const filterScale = scale < 1 ? 1 / scale : 1;
  const windowSize = Math.ceil(support) * 2;
  const weights = new Float32Array(dstLen * windowSize);
  const indices = new Int32Array(dstLen * windowSize);
  const counts = new Int32Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const left = Math.floor(center - support) + 1;
    let count = 0;
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      const srcIndex = left + j;
      if (srcIndex < 0 || srcIndex >= srcLen) continue;
      const w = lanczosKernel((srcIndex - center) / filterScale, a);
      if (w === 0) continue;
      weights[i * windowSize + count] = w;
      indices[i * windowSize + count] = srcIndex;
      sum += w;
      count++;
    }
    // Normalise so the row sums to 1 (handles edge truncation).
    if (sum !== 0) {
      for (let j = 0; j < count; j++) weights[i * windowSize + j] /= sum;
    }
    counts[i] = count;
  }
  return { weights, indices, counts, windowSize };
}

/** Premultiplied alpha Lanczos3 resample of an RGBA canvas. */
export function lanczos3Resample(src: HTMLCanvasElement, dstW: number, dstH: number): HTMLCanvasElement {
  const sw = src.width;
  const sh = src.height;
  if (sw === dstW && sh === dstH) return src;
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  const sdata = sctx.getImageData(0, 0, sw, sh).data;
  const a = 3;

  // Convert to premultiplied float buffer (avoids halos around transparent edges).
  const pm = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const p = i * 4;
    const alpha = sdata[p + 3] / 255;
    pm[p] = sdata[p] * alpha;
    pm[p + 1] = sdata[p + 1] * alpha;
    pm[p + 2] = sdata[p + 2] * alpha;
    pm[p + 3] = sdata[p + 3];
  }

  // Horizontal pass: sw → dstW
  const hPass = new Float32Array(dstW * sh * 4);
  const hw = buildLanczosWeights(sw, dstW, a);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dstW; x++) {
      const count = hw.counts[x];
      const base = x * hw.windowSize;
      let r = 0, g = 0, b = 0, al = 0;
      for (let j = 0; j < count; j++) {
        const w = hw.weights[base + j];
        const sx = hw.indices[base + j];
        const sp = (y * sw + sx) * 4;
        r += pm[sp] * w;
        g += pm[sp + 1] * w;
        b += pm[sp + 2] * w;
        al += pm[sp + 3] * w;
      }
      const dp = (y * dstW + x) * 4;
      hPass[dp] = r;
      hPass[dp + 1] = g;
      hPass[dp + 2] = b;
      hPass[dp + 3] = al;
    }
  }

  // Vertical pass: sh → dstH
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const vw = buildLanczosWeights(sh, dstH, a);
  for (let y = 0; y < dstH; y++) {
    const count = vw.counts[y];
    const base = y * vw.windowSize;
    for (let x = 0; x < dstW; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let j = 0; j < count; j++) {
        const w = vw.weights[base + j];
        const sy = vw.indices[base + j];
        const sp = (sy * dstW + x) * 4;
        r += hPass[sp] * w;
        g += hPass[sp + 1] * w;
        b += hPass[sp + 2] * w;
        al += hPass[sp + 3] * w;
      }
      const dp = (y * dstW + x) * 4;
      const a8 = al < 0 ? 0 : al > 255 ? 255 : al;
      if (a8 < 1) {
        out[dp] = 0;
        out[dp + 1] = 0;
        out[dp + 2] = 0;
        out[dp + 3] = 0;
      } else {
        const inv = 255 / a8;
        out[dp] = clampByte(r * inv);
        out[dp + 1] = clampByte(g * inv);
        out[dp + 2] = clampByte(b * inv);
        out[dp + 3] = a8;
      }
    }
  }

  const dst = makeCanvas(dstW, dstH);
  const dctx = dst.getContext("2d", { willReadFrequently: true })!;
  dctx.putImageData(new ImageData(out, dstW, dstH), 0, 0);
  return dst;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Nearest-neighbour integer scale (pixel art). */
function nearestUpscale(src: HTMLCanvasElement, dstW: number, dstH: number): HTMLCanvasElement {
  const dst = makeCanvas(dstW, dstH);
  const cx = dst.getContext("2d")!;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(src, 0, 0, dstW, dstH);
  return dst;
}

// ---------------------------------------------------------------------------
// 5×5 Gaussian unsharp mask (RGB only, alpha preserved)
// ---------------------------------------------------------------------------

// σ≈0.8 separable kernel
const GAUSS5 = new Float32Array([0.0545, 0.2442, 0.4026, 0.2442, 0.0545]);

function unsharpMask(canvas: HTMLCanvasElement, amount: number, threshold: number) {
  if (amount <= 0) return;
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const imgData = ctx.getImageData(0, 0, W, H);
  const px = imgData.data;

  const tmp = new Float32Array(W * H * 3);
  const blur = new Float32Array(W * H * 3);

  // Horizontal pass
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const oi = (y * W + x) * 3;
      let r = 0, g = 0, b = 0;
      for (let k = -2; k <= 2; k++) {
        const sx = Math.min(W - 1, Math.max(0, x + k));
        const sp = (y * W + sx) * 4;
        const w = GAUSS5[k + 2];
        r += px[sp] * w;
        g += px[sp + 1] * w;
        b += px[sp + 2] * w;
      }
      tmp[oi] = r;
      tmp[oi + 1] = g;
      tmp[oi + 2] = b;
    }
  }
  // Vertical pass
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const oi = (y * W + x) * 3;
      let r = 0, g = 0, b = 0;
      for (let k = -2; k <= 2; k++) {
        const sy = Math.min(H - 1, Math.max(0, y + k));
        const sp = (sy * W + x) * 3;
        const w = GAUSS5[k + 2];
        r += tmp[sp] * w;
        g += tmp[sp + 1] * w;
        b += tmp[sp + 2] * w;
      }
      blur[oi] = r;
      blur[oi + 1] = g;
      blur[oi + 2] = b;
    }
  }
  // Apply: out = orig + amount * (orig - blur), skip |diff| < threshold
  for (let i = 0, p = 0; p < px.length; p += 4, i += 3) {
    for (let c = 0; c < 3; c++) {
      const o = px[p + c];
      const d = o - blur[i + c];
      if (d > -threshold && d < threshold) continue;
      const v = o + amount * d;
      px[p + c] = clampByte(v);
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// ---------------------------------------------------------------------------
// Alpha re-binarisation for transparent logos / scanned text
// ---------------------------------------------------------------------------

function rebinariseAlpha(canvas: HTMLCanvasElement, lo: number, hi: number) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = imgData.data;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    if (a < lo) px[i] = 0;
    else if (a > hi) px[i] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

// ---------------------------------------------------------------------------
// Chroma smoothing for illustrations (anime-style flat colour)
// ---------------------------------------------------------------------------

function smoothChroma(canvas: HTMLCanvasElement, radius: number) {
  if (radius <= 0) return;
  // Small box blur on Cb/Cr (YCbCr) leaving Y intact — preserves line work.
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const imgData = ctx.getImageData(0, 0, W, H);
  const px = imgData.data;
  const Y = new Float32Array(W * H);
  const Cb = new Float32Array(W * H);
  const Cr = new Float32Array(W * H);
  for (let i = 0, p = 0; p < px.length; p += 4, i++) {
    const r = px[p];
    const g = px[p + 1];
    const b = px[p + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const blurCb = boxBlur(Cb, W, H, radius);
  const blurCr = boxBlur(Cr, W, H, radius);
  for (let i = 0, p = 0; p < px.length; p += 4, i++) {
    const y = Y[i];
    const cb = blurCb[i] - 128;
    const cr = blurCr[i] - 128;
    px[p] = clampByte(y + 1.402 * cr);
    px[p + 1] = clampByte(y - 0.344136 * cb - 0.714136 * cr);
    px[p + 2] = clampByte(y + 1.772 * cb);
  }
  ctx.putImageData(imgData, 0, 0);
}

function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const dst = new Float32Array(src.length);
  const tmp = new Float32Array(src.length);
  const win = r * 2 + 1;
  // Horizontal
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[y * W + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = sum / win;
      const add = src[y * W + Math.min(W - 1, x + r + 1)] ?? src[y * W + (W - 1)];
      const sub = src[y * W + Math.max(0, x - r)] ?? src[y * W];
      sum += add - sub;
    }
  }
  // Vertical
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      dst[y * W + x] = sum / win;
      const add = tmp[Math.min(H - 1, y + r + 1) * W + x] ?? tmp[(H - 1) * W + x];
      const sub = tmp[Math.max(0, y - r) * W + x] ?? tmp[x];
      sum += add - sub;
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface Pipeline {
  /** Resample function. Defaults to Lanczos3. */
  resample: (src: HTMLCanvasElement, w: number, h: number) => HTMLCanvasElement;
  /** Unsharp [amount, threshold]. amount ≤ 0 disables. */
  unsharp: [number, number];
  /** Alpha re-binarisation [lo, hi]. lo < 0 disables. */
  alpha?: [number, number];
  /** Chroma smoothing radius. 0 disables. */
  chroma: number;
  label: string;
}

function pipelineFor(kind: ImageKind, sharpness: number): Pipeline {
  // sharpness 0..100 → multiplier 0.4..1.6
  const m = 0.4 + (Math.max(0, Math.min(100, sharpness)) / 100) * 1.2;
  switch (kind) {
    case "pixel_art":
      return {
        resample: nearestUpscale,
        unsharp: [0, 0],
        chroma: 0,
        label: "Nearest-Neighbor (pixel art)",
      };
    case "line_art_logo":
      return {
        resample: lanczos3Resample,
        unsharp: [0.9 * m, 2],
        alpha: [32, 224],
        chroma: 0,
        label: "Lanczos3 + strong unsharp + binary alpha (logo)",
      };
    case "document_text":
      return {
        resample: lanczos3Resample,
        unsharp: [1.0 * m, 2],
        alpha: [48, 208],
        chroma: 0,
        label: "Lanczos3 + strong unsharp + binary alpha (text)",
      };
    case "illustration":
      return {
        resample: lanczos3Resample,
        unsharp: [0.6 * m, 3],
        chroma: 1,
        label: "Lanczos3 + chroma smoothing (illustration)",
      };
    case "photo":
    default:
      return {
        resample: lanczos3Resample,
        unsharp: [0.35 * m, 6],
        chroma: 0,
        label: "Lanczos3 + light unsharp (photo)",
      };
  }
}

function modeToKind(mode: UpscaleMode, auto: ImageKind): ImageKind {
  switch (mode) {
    case "logo":
      return "line_art_logo";
    case "text":
      return "document_text";
    case "illustration":
      return "illustration";
    case "photo":
      return "photo";
    case "pixel":
      return "pixel_art";
    case "auto":
    default:
      return auto;
  }
}

/**
 * Resample `img` to `targetW × targetH` using the algorithm that best matches
 * its content (pixel-art / logo / text / illustration / photo).
 *
 * Returns the result canvas plus the analysis used to choose the pipeline so
 * the UI can display it.
 */
export function smartUpscale(
  img: HTMLImageElement | HTMLCanvasElement,
  targetW: number,
  targetH: number,
  opts: SmartUpscaleOptions = {},
): SmartUpscaleResult {
  const { w, h } = srcDims(img);
  if (w === 0 || h === 0) throw new Error("이미지 크기가 0입니다");
  if (targetW < 1 || targetH < 1) throw new Error("출력 크기가 유효하지 않습니다");

  const analysis = analyzeImage(img);
  const kind = modeToKind(opts.mode ?? "auto", analysis.kind);
  const pipe = pipelineFor(kind, opts.sharpness ?? 50);

  const srcCanvas = toCanvas(img);
  const resampled = pipe.resample(srcCanvas, targetW, targetH);
  if (pipe.chroma > 0) smoothChroma(resampled, pipe.chroma);
  if (pipe.unsharp[0] > 0) unsharpMask(resampled, pipe.unsharp[0], pipe.unsharp[1]);
  // Only re-binarise alpha when the source actually had a binary-ish alpha
  // channel; otherwise we would destroy genuine anti-aliasing.
  if (pipe.alpha && analysis.binaryAlpha) {
    rebinariseAlpha(resampled, pipe.alpha[0], pipe.alpha[1]);
  }

  return { canvas: resampled, analysis: { ...analysis, kind }, method: pipe.label };
}

/**
 * Backwards-compatible drop-in for the old `edgePreservingUpscale` helper.
 * Returns just the canvas; uses `smartUpscale` under the hood.
 */
export function edgePreservingUpscale(
  img: HTMLImageElement | HTMLCanvasElement,
  targetW: number,
  targetH: number,
): HTMLCanvasElement {
  return smartUpscale(img, targetW, targetH).canvas;
}
