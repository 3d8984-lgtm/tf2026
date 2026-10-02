// Auto colour extraction: mood detection (dark / bright / vivid) + 7-slot tone-on-tone mapping
// with contrast clamping so text outlines never disappear into the background.
import type { Params } from './patternEngine';

export type AutoColors = Pick<Params, 'paper' | 'bgLine' | 'bgFill' | 'dotColor' | 'dotBg' | 'line' | 'fill' | 'accent'> & { bgFillPaper: boolean };
export type Mood = 'dark' | 'bright' | 'vivid';

type HSL = { h: number; s: number; l: number };
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const rgbToHsl = (r: number, g: number, b: number): HSL => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return { h, s, l };
};
const hsl = (h: number, s: number, l: number) => {
  h = ((h % 360) + 360) % 360; s = clamp(s); l = clamp(l);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
};
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const bw = (bg: string) => (contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111');

const cache = new Map<string, Promise<AutoColors | null>>();

export function extractAutoColors(dataUrl: string): Promise<AutoColors | null> {
  let p = cache.get(dataUrl);
  if (!p) { p = run(dataUrl).catch(() => null); cache.set(dataUrl, p); }
  return p;
}

async function run(dataUrl: string): Promise<AutoColors | null> {
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img')); img.src = dataUrl; });
  const S = 64, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const cx = cv.getContext('2d')!; cx.drawImage(img, 0, 0, S, S);
  const d = cx.getImageData(0, 0, S, S).data;
  const all: number[][] = [], chroma: number[][] = [];
  let lSum = 0, sSum = 0;
  for (let i = 0; i < S * S; i++) {
    if (d[i * 4 + 3] < 128) continue;
    const q = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]], c = rgbToHsl(q[0], q[1], q[2]);
    all.push(q); lSum += c.l; sSum += c.s;
    const mx = Math.max(...q), mn = Math.min(...q);
    if (!(mn > 245) && !(mx < 15)) chroma.push(q);
  }
  if (!all.length) return null;
  const L = lSum / all.length, Sat = sSum / all.length;
  const px = chroma.length >= 20 ? chroma : all;

  // k-means (6)
  let cents = Array.from({ length: 6 }, (_, k) => px[Math.floor(((k + 0.5) * px.length) / 6)].slice());
  let counts = new Array(6).fill(0);
  for (let it = 0; it < 8; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (const q of px) { let bi = 0, bd = 1e9; for (let k = 0; k < 6; k++) { const c = cents[k], dd = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (dd < bd) { bd = dd; bi = k; } } const a = acc[bi]; a[0] += q[0]; a[1] += q[1]; a[2] += q[2]; a[3]++; }
    cents = acc.map((a, k) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cents[k]));
    counts = acc.map(a => a[3]);
  }
  const pal = cents.map((c, k) => ({ ...rgbToHsl(c[0], c[1], c[2]), n: counts[k] })).filter(c => c.n > 0).sort((a, b) => b.n - a.n);
  const tot = pal.reduce((a, c) => a + c.n, 0);
  const vib = pal.filter(c => c.s > 0.3 && c.l > 0.2 && c.l < 0.8).sort((a, b) => b.s * Math.sqrt(b.n) - a.s * Math.sqrt(a.n));
  const vibrant = vib[0] || { h: pal[0].h, s: 0.75, l: 0.5, n: 0 };
  const dominant = pal.find(c => c.s > 0.15 && c.n / tot > 0.08) || vibrant;
  const sub = vib.find(c => Math.min(Math.abs(c.h - vibrant.h), 360 - Math.abs(c.h - vibrant.h)) >= 60);
  const subH = sub ? sub.h : vibrant.h + 180;
  const domS = Math.max(0.35, dominant.s);

  const mood: Mood = L < 0.38 ? 'dark' : L > 0.65 ? 'bright' : Sat >= 0.35 ? 'vivid' : 'bright';
  let c: AutoColors;
  if (mood === 'dark') {
    const paper = hsl(dominant.h, Math.min(0.6, domS), 0.19);
    c = { paper, bgLine: hsl(dominant.h, Math.min(0.6, domS), 0.31), bgFill: paper, bgFillPaper: true,
      dotColor: '#18181b', dotBg: hsl(vibrant.h, 0.6, 0.85), line: '#ffffff', fill: '#1a1a1a', accent: hsl(vibrant.h, Math.max(0.7, vibrant.s), 0.52) };
  } else if (mood === 'bright') {
    const paper = hsl(dominant.h, Math.min(0.7, domS), 0.88);
    c = { paper, bgLine: hsl(dominant.h, Math.min(0.6, domS), 0.73), bgFill: paper, bgFillPaper: true,
      dotColor: '#1e293b', dotBg: '#ffffff', line: '#111111', fill: '#222222', accent: hsl(subH, Math.max(0.65, sub?.s ?? 0.7), 0.5) };
  } else {
    const paper = hsl(dominant.h, Math.min(0.85, domS), 0.5);
    c = { paper, bgLine: hsl(dominant.h, Math.min(0.85, domS), 0.3), bgFill: paper, bgFillPaper: true,
      dotColor: hsl(vibrant.h, Math.max(0.7, vibrant.s), 0.45), dotBg: hsl(vibrant.h, 0.7, 0.88), line: bw(paper), fill: '#111111', accent: hsl(dominant.h + 180, 0.75, 0.5) };
  }
  // Contrast clamps: outline vs paper ≥ 4.5, fill vs outline ≥ 4.5, dots readable.
  if (contrast(c.line, c.paper) < 4.5) c.line = bw(c.paper);
  if (contrast(c.fill, c.line) < 4.5) c.fill = c.line === '#ffffff' ? '#111111' : '#ffffff';
  if (contrast(c.dotColor, c.dotBg) < 3) c.dotBg = bw(c.dotColor) === '#ffffff' ? '#ffffff' : '#111111';
  if (contrast(c.accent, c.line) < 2) c.accent = hsl(vibrant.h, 0.8, c.line === '#ffffff' ? 0.4 : 0.6);
  return c;
}

/** Apply extracted colours onto params when the format's auto-colour toggle is on. */
export async function applyAutoColors(p: Params, artDataUrl: string | null): Promise<Params> {
  if (!p.autoColor || !artDataUrl) return p;
  const c = await extractAutoColors(artDataUrl);
  return c ? { ...p, ...c } : p;
}
