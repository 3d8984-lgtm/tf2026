// Signature image vectorization (browser-only, no WASM).
// Pipeline: supersample 2x -> Gaussian blur -> hysteresis threshold ->
// morphological cleanup -> ImageTracer with bezier-biased params ->
// extract ink paths -> emit transparent SVG with single black fill.
// @ts-ignore - no types
import ImageTracer from "imagetracerjs";

export type VectorMethod = "bezier" | "imagetracer" | "potrace";

export const VECTOR_METHOD_LABELS: Record<VectorMethod, string> = {
  bezier: "Bezier Curve",
  imagetracer: "AI Vectorization",
  potrace: "Potrace",
};

export interface VectorizeOptions {
  /** 0-255. Pixels darker than this are definitely ink. */
  threshold?: number;
  /** Max width of the *original* before supersampling (perf cap). */
  maxWidth?: number;
  /** Supersample factor (1-3). Higher = smoother but slower. */
  supersample?: number;
}

interface Prepared {
  imageData: ImageData;
  width: number;
  height: number;
  /** Original (pre-supersample) dimensions, used for output viewBox. */
  origWidth: number;
  origHeight: number;
  canvas: HTMLCanvasElement;
}

async function loadToCanvas(
  url: string,
  maxWidth: number,
  supersample: number,
): Promise<Prepared> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("image load failed"));
    img.src = url;
  });
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (w > maxWidth) {
    const k = maxWidth / w;
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  const origW = w, origH = h;
  // Supersample: trace at higher resolution so the curves are smoother.
  const sw = Math.round(w * supersample);
  const sh = Math.round(h * supersample);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, sw, sh);
  const imageData = ctx.getImageData(0, 0, sw, sh);
  return { imageData, width: sw, height: sh, origWidth: origW, origHeight: origH, canvas };
}

/** Separable Gaussian blur on luminance only; returns an ImageData of luminance in R. */
function toLuminanceBlurred(src: ImageData, radius = 1): ImageData {
  const { width: w, height: h, data } = src;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3];
    // Treat fully transparent as paper-white so it never becomes ink.
    if (a < 8) { lum[p] = 255; continue; }
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  // 1D Gaussian kernel
  const sigma = Math.max(0.6, radius);
  const r = Math.max(1, Math.ceil(sigma * 2));
  const kernel = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        acc += lum[y * w + xx] * kernel[k + r];
      }
      tmp[y * w + x] = acc;
    }
  }
  // vertical
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[yy * w + x] * kernel[k + r];
      }
      const i = (y * w + x) * 4;
      const v = Math.round(acc);
      out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
    }
  }
  return out;
}

/** Hysteresis thresholding: strong ink + connected weak ink. */
function hysteresisThreshold(src: ImageData, hi: number, lo: number): ImageData {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const strong = new Uint8Array(n);
  const weak = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = data[i];
    if (v < lo) strong[p] = 1;
    else if (v < hi) weak[p] = 1;
  }
  // Flood-fill weak pixels connected to strong ones.
  const stack: number[] = [];
  for (let p = 0; p < n; p++) if (strong[p]) stack.push(p);
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (weak[q] && !strong[q]) { strong[q] = 1; stack.push(q); }
      }
    }
  }
  const out = new ImageData(w, h);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (strong[p]) {
      out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255;
    } else {
      out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; out.data[i + 3] = 0;
    }
  }
  return out;
}

/** Remove isolated ink specks (< minNeighbors of 8). */
function removeSpecks(src: ImageData, minNeighbors = 2): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  out.data.set(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = ((y + dy) * w + (x + dx)) * 4;
        if (data[j + 3] > 0) n++;
      }
      if (n < minNeighbors) {
        out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; out.data[i + 3] = 0;
      }
    }
  }
  return out;
}

function wrapSvg(pathsXml: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="#000" stroke="none">${pathsXml}</svg>`;
}

function normalizeSvg(rawSvg: string, viewW: number, viewH: number): string {
  const paths: string[] = [];
  const tagRe = /<path\b[^>]*\/?>/gi;
  const attr = (tag: string, name: string) =>
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? "";
  const isInkPath = (tag: string) => {
    const fill = attr(tag, "fill").replace(/\s+/g, "").toLowerCase();
    const opacity = Number(attr(tag, "opacity") || "1");
    const visible = Number.isFinite(opacity) ? opacity > 0.01 : true;
    return (
      visible &&
      (fill === "#000" || fill === "#000000" || fill === "black" || fill === "rgb(0,0,0)")
    );
  };
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(rawSvg))) {
    const tag = m[0];
    const d = attr(tag, "d");
    if (d && isInkPath(tag)) paths.push(`<path d="${d}" fill="#000" stroke="none"/>`);
  }
  if (!paths.length) {
    throw new Error("벡터화 결과가 비어 있습니다. 임계값(threshold)을 조정해 보세요.");
  }
  return wrapSvg(paths.join(""), viewW, viewH);
}

function vectorizeImageTracer(prepared: Prepared, opts: any): string {
  const svg: string = ImageTracer.imagedataToSVG(prepared.imageData, {
    pal: [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 0 },
    ],
    colorsampling: 0,
    numberofcolors: 2,
    mincolorratio: 0,
    colorquantcycles: 1,
    blurradius: 0,
    blurdelta: 20,
    strokewidth: 0,
    linefilter: true,
    // We supersampled by `supersample`; scaling here reverses it so the path
    // coordinates land in the original image's coordinate system.
    scale: prepared.origWidth / prepared.width,
    roundcoords: 2,
    viewbox: true,
    desc: false,
    ...opts,
  });
  return normalizeSvg(svg, prepared.origWidth, prepared.origHeight);
}

export async function vectorizeSignature(
  url: string,
  method: VectorMethod,
  opts: VectorizeOptions = {},
): Promise<string> {
  const threshold = opts.threshold ?? 160;
  const maxWidth = opts.maxWidth ?? 1200;
  const supersample = Math.max(1, Math.min(3, opts.supersample ?? 2));

  const raw = await loadToCanvas(url, maxWidth, supersample);

  // 1) Luminance + Gaussian blur (soft edges -> smoother traced curves).
  const blurred = toLuminanceBlurred(raw.imageData, 1.2);

  // 2) Hysteresis threshold: hi = main, lo = hi+30 to recover thin strokes.
  const hi = threshold;
  const lo = Math.min(230, threshold + 35);
  const inked = hysteresisThreshold(blurred, hi, lo);

  // 3) Drop isolated specks but keep fine ink connected to strong pixels.
  const cleaned = removeSpecks(inked, 2);

  const prepared: Prepared = {
    imageData: cleaned,
    width: raw.width,
    height: raw.height,
    origWidth: raw.origWidth,
    origHeight: raw.origHeight,
    canvas: raw.canvas,
  };

  if (method === "potrace") {
    // Potrace-like: minimal nodes, very smooth curves.
    return vectorizeImageTracer(prepared, {
      ltres: 2.5,
      qtres: 0.5,
      pathomit: 20,
      rightangleenhance: false,
    });
  }
  if (method === "imagetracer") {
    // Detail-preserving handwriting feel.
    return vectorizeImageTracer(prepared, {
      ltres: 1,
      qtres: 0.6,
      pathomit: 8,
      rightangleenhance: false,
    });
  }
  // Bezier: strongly bias toward quadratic/cubic curves (high ltres, low qtres).
  return vectorizeImageTracer(prepared, {
    ltres: 4,
    qtres: 0.3,
    pathomit: 12,
    rightangleenhance: false,
  });
}
