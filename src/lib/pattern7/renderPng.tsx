import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import PatternFrame from "./PatternFrame";
import { BUILTIN_SHAPES, Params, Shape, analyzeImage, applyAnalysis, pickShapes } from "./patternEngine";
import type { Saved } from "./PatternStudio7";

/** Stable 32-bit hash → positive seed (per-design uniqueness). */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 999_983) + 1;
}

const dataUrlCache = new Map<string, Promise<string>>();

async function fetchViaProxy(url: string): Promise<Blob> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: { session } } = await supabase.auth.getSession();
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const res = await fetch(`${base}/functions/v1/download-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${session?.access_token ?? anon}` },
    body: JSON.stringify({ url, filename: "art.bin" }),
  });
  if (!res.ok) throw new Error(`이미지를 불러오지 못했습니다 (${res.status})`);
  return await res.blob();
}

export function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return Promise.resolve(url);
  let p = dataUrlCache.get(url);
  if (!p) {
    p = urlToDataUrlUncached(url);
    p.catch(() => dataUrlCache.delete(url));
    dataUrlCache.set(url, p);
  }
  return p;
}

async function urlToDataUrlUncached(url: string): Promise<string> {
  let blob: Blob;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    blob = await res.blob();
  } catch {
    blob = await fetchViaProxy(url);
  }
  return await new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(rd.result as string);
    rd.onerror = reject;
    rd.readAsDataURL(blob);
  });
}

/**
 * Resolve the final params + shapes for one order item.
 * Uses the saved format values exactly as configured (no per-item re-analysis or reshuffle),
 * so the output matches the format settings screen.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolveItemPattern(format: Saved, _designUid: string, _artDataUrl: string | null) {
  const p: Params = { ...format.p };
  const uploaded = format.shapes.filter((s): s is Shape => !!s && !!s.data).map((s) => ({ url: s.data!, data: s.data }));
  const all = uploaded.length ? uploaded : BUILTIN_SHAPES;
  const shapes = pickShapes(all, p);
  const bgShapes = format.bgShapes.filter((s): s is Shape => !!s && !!s.data).map((s) => ({ url: s.data!, data: s.data }));
  return { p, shapes, bgShapes, frameSvg: format.frameSvg ?? null };
}

/**
 * Rasterize the pattern frame to PNG at `sizePx`. The DOM (CSS masks + SVG filters) is laid out at
 * the target pixel size and drawn through an SVG foreignObject so outlines stay sharp at print DPI.
 * All image references must be data URLs (blob URLs don't load inside SVG images).
 */
export async function renderPatternPng(opts: {
  p: Params; shapes: Shape[]; bgShapes: Shape[]; artDataUrl: string | null; sizePx: number; frameSvg?: string | null;
}): Promise<Blob> {
  const { p, shapes, bgShapes, artDataUrl, sizePx, frameSvg } = opts;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${sizePx}px;height:${sizePx}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(<PatternFrame p={p} shapes={shapes} bgShapes={bgShapes} artUrl={artDataUrl} frameW={sizePx} plain frameSvg={frameSvg} />);
    });
    const node = host.firstElementChild as HTMLElement;
    const xml = new XMLSerializer().serializeToString(node);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}"><foreignObject x="0" y="0" width="${sizePx}" height="${sizePx}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${sizePx}px;height:${sizePx}px;margin:0;">${xml}</div></foreignObject></svg>`;
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("패턴 이미지를 렌더링하지 못했습니다."));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
    // Give the browser a frame to finish decoding nested data URLs.
    await new Promise((r) => setTimeout(r, 50));
    const cv = document.createElement("canvas");
    cv.width = sizePx; cv.height = sizePx;
    cv.getContext("2d")!.drawImage(img, 0, 0, sizePx, sizePx);
    return await new Promise<Blob>((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))), "image/png"));
  } finally {
    root.unmount();
    host.remove();
  }
}

export const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);
