// Signature image vectorization.
// 3 methods: "potrace" (esm-potrace-wasm), "imagetracer" (AI vectorization),
// "bezier" (ImageTracer tuned for cubic/quadratic bezier curves).
// All methods return an SVG string with:
//  - transparent background
//  - single black fill (#000)
//  - tight viewBox sized to the source pixels.
import { potrace, init as potraceInit } from "esm-potrace-wasm";
// @ts-ignore - no types
import ImageTracer from "imagetracerjs";

export type VectorMethod = "bezier" | "imagetracer" | "potrace";

export const VECTOR_METHOD_LABELS: Record<VectorMethod, string> = {
  bezier: "Bezier Curve",
  imagetracer: "AI Vectorization",
  potrace: "Potrace",
};

export interface VectorizeOptions {
  /** 0-255. Pixels with luminance below this become ink (black). */
  threshold?: number;
  /** Optional max width to downsample to before tracing (perf). */
  maxWidth?: number;
}

interface Prepared {
  imageData: ImageData;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

async function loadToCanvas(url: string, maxWidth = 1200): Promise<Prepared> {
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
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { imageData, width: w, height: h, canvas };
}

/**
 * Binarize: any pixel with low luminance OR sufficient alpha becomes opaque black,
 * everything else becomes transparent. This kills JPEG noise + light backgrounds.
 */
function binarize(src: ImageData, threshold: number): ImageData {
  const out = new ImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const r = s[i], g = s[i + 1], b = s[i + 2], a = s[i + 3];
    // Pixels with low alpha treated as background
    if (a < 32) {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
      continue;
    }
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const ink = lum < threshold;
    if (ink) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
    } else {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
  return out;
}

/** Light 3x3 median to kill salt/pepper noise before tracing. */
function denoise(src: ImageData): ImageData {
  const { width: w, height: h, data: s } = src;
  const out = new ImageData(w, h);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // majority vote within 3x3 (binary input)
      let ink = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = (yy * w + xx) * 4;
          if (s[j] === 0) ink++;
          total++;
        }
      }
      const isInk = ink * 2 > total; // majority
      d[i] = isInk ? 0 : 255;
      d[i + 1] = d[i];
      d[i + 2] = d[i];
      d[i + 3] = 255;
    }
  }
  return out;
}

/** Wrap path data into a clean SVG with transparent bg + black fill. */
function wrapSvg(pathsXml: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="#000" stroke="none">${pathsXml}</svg>`;
}

/** Extract <path d="..."> from an arbitrary svg string and re-wrap with our standard frame. */
function normalizeSvg(rawSvg: string, fallbackW: number, fallbackH: number): string {
  // Read viewBox / width / height if present
  const vb = rawSvg.match(/viewBox\s*=\s*"([^"]+)"/i);
  let w = fallbackW, h = fallbackH;
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) { w = p[2]; h = p[3]; }
  }
  // Collect every <path .../> and force black fill, no stroke
  const paths: string[] = [];
  const re = /<path\b[^>]*\bd\s*=\s*"([^"]+)"[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawSvg))) {
    paths.push(`<path d="${m[1]}" fill="#000" stroke="none"/>`);
  }
  if (!paths.length) {
    // Fallback: keep original body but force fill=#000 and remove fill="#fff" rects
    const body = rawSvg
      .replace(/<\?xml[^>]*\?>/g, "")
      .replace(/<svg\b[^>]*>/i, "")
      .replace(/<\/svg>/i, "")
      .replace(/fill\s*=\s*"#?fff(?:fff)?"/gi, 'fill="none"')
      .replace(/fill\s*=\s*"white"/gi, 'fill="none"');
    return wrapSvg(body, w, h);
  }
  return wrapSvg(paths.join(""), w, h);
}

async function vectorizePotrace(prepared: Prepared): Promise<string> {
  await potraceInit();
  // Feed potrace an ImageBitmap built from the cleaned canvas.
  const blob: Blob = await new Promise((res, rej) =>
    prepared.canvas.toBlob(b => (b ? res(b) : rej(new Error("blob failed"))), "image/png"),
  );
  const bitmap = await createImageBitmap(blob);
  // NOTE: esm-potrace-wasm only supports the option keys below.
  // `color` / `background` are NOT valid here — passing them silently breaks output.
  const svg = await potrace(bitmap, {
    turdsize: 2,
    turnpolicy: 4,
    alphamax: 1,
    opticurve: 1,
    opttolerance: 0.2,
    pathonly: false,
    extractcolors: false,
    posterizelevel: 1,
    posterizationalgorithm: 0,
  } as any);
  return normalizeSvg(svg, prepared.width, prepared.height);
}

function vectorizeImageTracer(prepared: Prepared, opts: any): string {
  const svg: string = ImageTracer.imagedataToSVG(prepared.imageData, {
    // 2-color palette: ink (black) + paper (transparent)
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
    linefilter: false,
    scale: 1,
    roundcoords: 1,
    viewbox: true,
    desc: false,
    ...opts,
  });
  return normalizeSvg(svg, prepared.width, prepared.height);
}

export async function vectorizeSignature(
  url: string,
  method: VectorMethod,
  opts: VectorizeOptions = {},
): Promise<string> {
  const threshold = opts.threshold ?? 160;
  const maxWidth = opts.maxWidth ?? 1200;
  const raw = await loadToCanvas(url, maxWidth);
  const bin = binarize(raw.imageData, threshold);
  const clean = denoise(bin);
  // Put cleaned data back into the canvas (potrace consumes the canvas)
  const ctx = raw.canvas.getContext("2d")!;
  ctx.putImageData(clean, 0, 0);
  const prepared: Prepared = { imageData: clean, width: raw.width, height: raw.height, canvas: raw.canvas };

  if (method === "potrace") return vectorizePotrace(prepared);
  if (method === "imagetracer") {
    // Detail-preserving: more linear segments, lower smoothing → keeps handwriting feel
    return vectorizeImageTracer(prepared, {
      ltres: 1,
      qtres: 1,
      pathomit: 8,
      rightangleenhance: false,
    });
  }
  // bezier: bias toward cubic/quadratic curves with stronger smoothing
  return vectorizeImageTracer(prepared, {
    ltres: 0.1,
    qtres: 0.1,
    pathomit: 4,
    rightangleenhance: false,
  });
}
