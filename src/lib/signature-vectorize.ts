// Signature image vectorization.
// 3 methods: "bezier" (cubic/quadratic-biased), "imagetracer" (AI-ish detail),
// "potrace" (Potrace-style: heavy smoothing, minimal nodes).
// All built on ImageTracer for a single, reliable runtime (no WASM init required).
// Output SVG: transparent background, single black fill, tight viewBox.
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

function binarize(src: ImageData, threshold: number): ImageData {
  const out = new ImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const r = s[i], g = s[i + 1], b = s[i + 2], a = s[i + 3];
    if (a < 32) {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 0;
      continue;
    }
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < threshold) {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
    } else {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 0;
    }
  }
  return out;
}

function denoise(src: ImageData): ImageData {
  const { width: w, height: h, data: s } = src;
  const out = new ImageData(w, h);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let ink = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = (yy * w + xx) * 4;
          if (s[j + 3] > 0 && s[j] === 0) ink++;
          total++;
        }
      }
      const isInk = ink * 2 > total;
      d[i] = isInk ? 0 : 255;
      d[i + 1] = d[i];
      d[i + 2] = d[i];
      d[i + 3] = isInk ? 255 : 0;
    }
  }
  return out;
}

function wrapSvg(pathsXml: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="#000" stroke="none">${pathsXml}</svg>`;
}

function normalizeSvg(rawSvg: string, fallbackW: number, fallbackH: number): string {
  const vb = rawSvg.match(/viewBox\s*=\s*"([^"]+)"/i);
  let w = fallbackW, h = fallbackH;
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) { w = p[2]; h = p[3]; }
  }
  const paths: string[] = [];
  const tagRe = /<path\b[^>]*\/?>/gi;
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? "";
  const isInkPath = (tag: string) => {
    const fill = attr(tag, "fill").replace(/\s+/g, "").toLowerCase();
    const opacity = Number(attr(tag, "opacity") || "1");
    const visible = Number.isFinite(opacity) ? opacity > 0.01 : true;
    return visible && (fill === "#000" || fill === "#000000" || fill === "black" || fill === "rgb(0,0,0)");
  };
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(rawSvg))) {
    const tag = m[0];
    const d = attr(tag, "d");
    if (d && isInkPath(tag)) {
      paths.push(`<path d="${d}" fill="#000" stroke="none"/>`);
    }
  }
  if (!paths.length) {
    throw new Error("벡터화 결과가 비어 있습니다. 임계값(threshold)을 조정해 보세요.");
  }
  return wrapSvg(paths.join(""), w, h);
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
  const ctx = raw.canvas.getContext("2d")!;
  ctx.putImageData(clean, 0, 0);
  const prepared: Prepared = { imageData: clean, width: raw.width, height: raw.height, canvas: raw.canvas };

  if (method === "potrace") {
    // Potrace-style: aggressive node reduction, smooth curves, strong noise rejection
    return vectorizeImageTracer(prepared, {
      ltres: 1.5,
      qtres: 1.5,
      pathomit: 16,
      rightangleenhance: false,
      roundcoords: 2,
    });
  }
  if (method === "imagetracer") {
    // Detail-preserving handwriting feel
    return vectorizeImageTracer(prepared, {
      ltres: 1,
      qtres: 1,
      pathomit: 8,
      rightangleenhance: false,
    });
  }
  // bezier: bias toward smooth cubic/quadratic curves
  return vectorizeImageTracer(prepared, {
    ltres: 0.1,
    qtres: 0.1,
    pathomit: 4,
    rightangleenhance: false,
  });
}
