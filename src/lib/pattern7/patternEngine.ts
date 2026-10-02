// Pattern Studio 7 — Sticker Outline engine (framework-agnostic)
// Port of the HTML prototype logic. All geometry is in % of the frame box (0..100).

export type Shape = { url: string; data?: string };

export type Params = {
  auto: boolean; autoStrength: number; pickCount: number; pickSeed: number;
  // placement
  count: number; size: number; sizeVar: number; bleed: number;
  rot: 'none' | 'free' | 'tilt' | 'quarter'; rotAmt: number;
  layout: 'poisson' | 'scatter' | 'grid' | 'rows'; jitter: number; overlap: number;
  // sticker
  outline: number; knockout: boolean; knockWidth: number; inner: number;
  hatch: number; hatchGap: number; hatchMin: number; hatchLine: number; hatchAngle: number;
  accentRatio: number;
  // shadow
  shadowOn: boolean; shadow: number; shadowAngle: number; shadowMode: 'dot' | 'solid';
  shDotGap: number; shDotSize: number; shDotFade: number; shDotAngle: number; shadowColor: string;
  // pop dots
  dotRatio: number; dotSize: number; dotGap: number; dotPos: 'tl' | 'br' | 'center' | 'edge';
  dotFade: number; dotMax: number; dotMin: number; dotOrder: number; dotAngle: number; dotColor: string; dotBg: string;
  // background outline layer
  bgOn: boolean; bgCount: number; bgSize: number; bgSizeVar: number; bgRot: number; bgOverlap: number;
  bgStroke: number; bgLine: string; bgFill: string; bgFillPaper: boolean; bgOcclude: boolean; bgRows: 0 | 1 | 2; bgRowJitter: number;
  // colours
  paper: string; line: string; fill: string; accent: string;
  seed: number;
};

export const DEFAULTS: Params = {
  auto: true, autoStrength: 100, pickCount: 4, pickSeed: 1,
  count: 70, size: 105, sizeVar: 20, bleed: 80, rot: 'free', rotAmt: 30, layout: 'poisson', jitter: 40, overlap: 25,
  outline: 10, knockout: false, knockWidth: 100, inner: 0,
  hatch: 10, hatchGap: 12, hatchMin: 5, hatchLine: 50, hatchAngle: 45, accentRatio: 20,
  shadowOn: true, shadow: 8, shadowAngle: 135, shadowMode: 'dot', shDotGap: 7, shDotSize: 70, shDotFade: 50, shDotAngle: 45, shadowColor: '#00c2ff',
  dotRatio: 30, dotSize: 50, dotGap: 9, dotPos: 'tl', dotFade: 60, dotMax: 95, dotMin: 10, dotOrder: 100, dotAngle: 45, dotColor: '#111111', dotBg: '#f5d800',
  bgOn: true, bgCount: 90, bgSize: 110, bgSizeVar: 40, bgRot: 60, bgOverlap: 40, bgStroke: 4, bgLine: '#111111', bgFill: '#ff0000', bgFillPaper: true, bgOcclude: true, bgRows: 0, bgRowJitter: 30,
  paper: '#ff0000', line: '#ffffff', fill: '#111111', accent: '#ff0000',
  seed: 1,
};

// Frame geometry from the TWINMETA frame SVG (566.93 canvas):
// red octagon spans 20.108..546.822 (F = 526.714), chamfer 43.386, red band width 34.016.
export const FRAME = (() => {
  const F = 526.714, B = 34.016, C = 43.386;
  return { F, B, C, bp: (B / F) * 100, cp: (C / F) * 100, inset: (20.108 / 566.93) * 100, span: (F / 566.93) * 100 };
})();

export const rng = (seed: number) => {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
};

export const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

export function pickShapes<T>(all: T[], p: Params): T[] {
  const n = Math.max(1, Math.min(p.pickCount || all.length, all.length));
  const r = rng((p.pickSeed || 1) * 31 + 7);
  const idx = all.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, n).sort((a, b) => a - b).map(i => all[i]);
}

const svgUrl = (body: string) =>
  'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#000" shape-rendering="crispEdges">${body}</svg>`);

export const BUILTIN_SHAPES: Shape[] = [
  '<path d="M14 6h22v70h50v18H14Z"/>',
  '<path d="M12 6h26v32h24V6h26v88H62V62H38v32H12Z"/>',
  '<path d="M50 4a46 46 0 1 0 0 92 46 46 0 0 0 0-92Zm0 28a18 18 0 1 1 0 36 18 18 0 0 1 0-36Z"/>',
  '<path d="M6 6h88v24H63v64H37V30H6Z"/>',
  '<path d="M10 6h80v24H36v10h48v22H36v8h54v24H10Z"/>',
  '<path d="M8 6h26l16 30 16-30h26v88H68V52L56 74H44L32 52v42H8Z"/>',
  '<path d="M14 6h40a30 30 0 0 1 0 60H40v28H14Z M40 30v12h12a6 6 0 0 0 0-12Z"/>',
  '<path d="M6 6h26l18 52 18-52h26L66 94H34Z"/>',
  '<path d="M14 6h36a44 44 0 0 1 0 88H14Z M40 30v40h8a20 20 0 0 0 0-40Z"/>',
  '<path d="M50 4a46 46 0 0 0 0 92c14 0 26-6 34-16L66 66a22 22 0 1 1 0-32l18-14A46 46 0 0 0 50 4Z"/>',
  '<path d="M14 6h36a26 26 0 0 1 14 48 26 26 0 0 1-14 40H14Z M40 26v14h8a7 7 0 0 0 0-14Z M40 60v16h10a8 8 0 0 0 0-16Z"/>',
  '<path d="M8 6h28l14 28 14-28h28L64 58v36H36V58Z"/>',
].map(b => ({ url: svgUrl(b) }));

// ---------- image → mask (black ink on white/transparent → alpha mask PNG) ----------
export function fileToMask(file: File): Promise<Shape> {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const S = 512, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
        const x = cv.getContext('2d')!;
        const r = Math.min(S / img.width, S / img.height), w = img.width * r, h = img.height * r;
        x.fillStyle = '#fff'; x.fillRect(0, 0, S, S); x.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
        const d = x.getImageData(0, 0, S, S), a = d.data;
        let hasAlpha = false; for (let k = 3; k < a.length; k += 4) if (a[k] < 250) { hasAlpha = true; break; }
        for (let k = 0; k < a.length; k += 4) {
          const lum = (a[k] * 299 + a[k + 1] * 587 + a[k + 2] * 114) / 1000;
          let al = hasAlpha ? a[k + 3] * (1 - (lum / 255) * 0.15) : 255 - lum;
          al = al > 110 ? 255 : 0; // hard threshold → solid outlines after dilation
          a[k] = a[k + 1] = a[k + 2] = 0; a[k + 3] = al;
        }
        x.putImageData(d, 0, 0);
        const data = cv.toDataURL('image/png');
        cv.toBlob(b => resolve({ url: URL.createObjectURL(b!), data }));
      };
      img.onerror = reject; img.src = rd.result as string;
    };
    rd.onerror = reject; rd.readAsDataURL(file);
  });
}

// Restore blob URLs from persisted data URLs (data: URLs contain ';' which breaks inline style strings).
const blobCache: Record<string, string> = {};
export function blobify(u?: string | null) {
  if (!u || !u.startsWith('data:')) return u || '';
  if (blobCache[u]) return blobCache[u];
  const [h, b64] = u.split(','); const mime = (h.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return (blobCache[u] = URL.createObjectURL(new Blob([arr], { type: mime })));
}

// ---------- image analysis (k-means palette + brightness/contrast/complexity) ----------
export type Scheme = { label: string; paper: string; line: string; fill: string; accent: string };
export type Analysis = { schemes: Scheme[]; palette: string[]; brightness: number; contrast: number; complexity: number };

export function analyzeImage(file: File): Promise<{ art: string; analysis: Analysis }> {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const S = 640, cv = document.createElement('canvas');
        const r = Math.min(S / img.width, S / img.height), w = Math.round(img.width * r), h = Math.round(img.height * r);
        cv.width = w; cv.height = h; cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
        const art = cv.toDataURL('image/jpeg', 0.86);
        const sc = document.createElement('canvas'); sc.width = 64; sc.height = 64;
        const sx = sc.getContext('2d')!; sx.drawImage(img, 0, 0, 64, 64);
        const d = sx.getImageData(0, 0, 64, 64).data;
        const N = 64 * 64, px: number[][] = []; let lumSum = 0; const lums: number[] = []; let edge = 0;
        for (let i = 0; i < N; i++) {
          const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2], lum = (R * 299 + G * 587 + B * 114) / 1000;
          lumSum += lum; lums.push(lum); px.push([R, G, B]);
          if (i % 64 < 63) { const l2 = (d[i * 4 + 4] * 299 + d[i * 4 + 5] * 587 + d[i * 4 + 6] * 114) / 1000; if (Math.abs(lum - l2) > 40) edge++; }
        }
        const mean = lumSum / N, sd = Math.sqrt(lums.reduce((a, l) => a + (l - mean) ** 2, 0) / N);
        let cents = [0, 1, 2, 3, 4, 5].map(k => px[Math.floor((k + 0.5) * N / 6)].slice());
        for (let it = 0; it < 8; it++) {
          const acc = cents.map(() => [0, 0, 0, 0]);
          for (const q of px) { let bi = 0, bd = 1e9; for (let k = 0; k < cents.length; k++) { const c = cents[k], dd = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (dd < bd) { bd = dd; bi = k; } } const a = acc[bi]; a[0] += q[0]; a[1] += q[1]; a[2] += q[2]; a[3]++; }
          cents = acc.map((a, k) => a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3], a[3]] : [...cents[k], 0]);
        }
        const toHsl = ([r, g, b]: number[]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const dl = mx - mn; s = l > 0.5 ? dl / (2 - mx - mn) : dl / (mx + mn); h = mx === r ? (g - b) / dl + (g < b ? 6 : 0) : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4; h *= 60; } return { h, s, l }; };
        const hslHex = (h: number, s: number, l: number) => { h = ((h % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2; let r = 0, g = 0, b = 0; if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; } return hex((r + m) * 255, (g + m) * 255, (b + m) * 255); };
        const palette = cents.filter(c => c[3] > N * 0.01).map(c => { const hs = toHsl(c); return { hex: hex(c[0], c[1], c[2]), n: c[3], s: hs.s, l: hs.l * 255, h: hs.h, hsl: hs }; }).sort((a, b) => b.n - a.n);
        const vivid = [...palette].sort((a, b) => b.s * Math.sqrt(b.n) - a.s * Math.sqrt(a.n)), vv = vivid.filter(c => c.s > 0.2 && c.l > 40 && c.l < 215);
        const main = vv[0] || palette[0], dark = [...palette].sort((a, b) => a.l - b.l)[0], light = [...palette].sort((a, b) => b.l - a.l)[0];
        const vivids = vv.slice(0, 4).map(c => c.hex); while (vivids.length < 4) vivids.push(hslHex(main.h + vivids.length * 70, 0.7, 0.5));
        const schemes: Scheme[] = [
          { label: 'TWINMETA 레드 + 검은 글자 흰 선', paper: '#ff0000', line: '#ffffff', fill: '#111111', accent: vivids[0] },
          { label: '검은 바탕 흰 선', paper: dark && dark.l < 80 ? dark.hex : '#111111', line: '#ffffff', fill: '#111111', accent: vivids[0] },
          { label: '흰 바탕 검은 선', paper: light && light.l > 190 ? light.hex : '#ffffff', line: '#111111', fill: '#ffffff', accent: vivids[0] },
          { label: '주조색 바탕 + 이미지 강조', paper: hslHex(main.h, Math.min(0.7, main.hsl.s), 0.5), line: '#111111', fill: '#ffffff', accent: vivids[1] || '#ff0000' },
        ];
        resolve({ art, analysis: { schemes, palette: palette.slice(0, 5).map(c => c.hex), brightness: mean / 255, contrast: Math.min(1, sd / 80), complexity: Math.min(1, edge / (N * 0.25)) } });
      };
      img.onerror = reject; img.src = rd.result as string;
    };
    rd.onerror = reject; rd.readAsDataURL(file);
  });
}

// Layout-only auto-apply (never touches colours or base size).
export function applyAnalysis(p: Params, a: Analysis): Partial<Params> {
  const lerp = (lo: number, hi: number, t: number) => Math.round(lo + (hi - lo) * t);
  const k = Math.max(0, Math.min(1, (p.autoStrength ?? 100) / 100));
  const mix = (base: number, target: number) => Math.round(base + (target - base) * k);
  const D = DEFAULTS;
  return {
    count: mix(D.count, lerp(80, 320, 1 - a.brightness)),
    hatch: mix(D.hatch, lerp(0, 60, a.contrast)),
    sizeVar: mix(D.sizeVar, lerp(10, 80, a.complexity)),
    rotAmt: mix(D.rotAmt, lerp(0, 120, a.complexity)),
    jitter: mix(D.jitter, lerp(20, 100, a.complexity)),
    seed: k > 0 ? Math.round(a.brightness * 97 + a.contrast * 53 + a.complexity * 31) + 1 : p.seed,
  };
}

// ---------- textures ----------
export function shadowTexture(p: Params) {
  const S = 200, g = p.shDotGap * 2, n = Math.ceil((S * 1.5) / g), fade = p.shDotFade / 100, rMax = (g * (p.shDotSize / 100)) / 2;
  const a = (p.shDotAngle * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const dir = (p.shadowAngle * Math.PI) / 180, dx = Math.cos(dir), dy = Math.sin(dir);
  let c = '';
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const x = i * g, y = j * g, rx = S / 2 + x * cos - y * sin, ry = S / 2 + x * sin + y * cos;
    if (rx < -g || ry < -g || rx > S + g || ry > S + g) continue;
    const t = Math.max(0, Math.min(1, ((rx - S / 2) * dx + (ry - S / 2) * dy) / S + 0.5));
    const rad = rMax * (1 - fade + fade * t); if (rad < 0.3) continue;
    c += `<circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="${rad.toFixed(1)}"/>`;
  }
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" fill="${p.shadowColor}">${c}</svg>`);
}

export function dotTexture(p: Params, r: () => number) {
  const S = 200, g = p.dotGap * 2, n = Math.ceil((S * 1.5) / g), fade = p.dotFade / 100;
  const rMax = (g * (p.dotMax ?? 95)) / 100 / 2, rMin = (g * (p.dotMin ?? 10)) / 100 / 2;
  const jit = (100 - (p.dotOrder ?? 100)) / 100, a = ((p.dotAngle || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const weight = (x: number, y: number) => { const u = x / S, v = y / S; switch (p.dotPos) { case 'br': return 1 - (u + v) / 2; case 'center': return 1 - Math.hypot(u - 0.5, v - 0.5) * 1.4; case 'edge': return Math.hypot(u - 0.5, v - 0.5) * 1.4; default: return (u + v) / 2; } };
  let c = '';
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const x = i * g + (r() * 2 - 1) * g * 0.4 * jit, y = j * g + (r() * 2 - 1) * g * 0.4 * jit;
    const rx = S / 2 + x * cos - y * sin, ry = S / 2 + x * sin + y * cos;
    if (rx < -g || ry < -g || rx > S + g || ry > S + g) continue;
    const wgt = Math.max(0, Math.min(1, weight(rx, ry))), w2 = 1 - fade + fade * wgt;
    const rad = Math.max(0.3, (rMin + (rMax - rMin) * w2) * ((p.dotSize / 100) * 2) * (1 + (r() * 2 - 1) * 0.6 * jit));
    c += `<circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="${rad.toFixed(1)}"/>`;
  }
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="${p.dotBg}"/><g fill="${p.dotColor}">${c}</g></svg>`);
}

// ---------- geometry helpers ----------
const bandRects = (bp: number): [number, number, number, number][] => [
  [0, 0, 100, bp], [0, 100 - bp, 100, bp], [0, bp, bp, 100 - 2 * bp], [100 - bp, bp, bp, 100 - 2 * bp],
];
const pickRect = (r: () => number, rects: [number, number, number, number][]) => {
  const total = rects.reduce((a, q) => a + q[2] * q[3], 0);
  let t = r() * total; for (const rc of rects) { if (t < rc[2] * rc[3]) return rc; t -= rc[2] * rc[3]; } return rects[0];
};

export type Glyph = {
  cx: number; cy: number; sz: number; rot: number; bucket: number; shape: Shape;
  kind: 'fill' | 'hatch' | 'dot' | 'accent'; dotTex?: string;
  hatchPx: number; hatchLinePx: number;
  shadowDx: number; shadowDy: number;
};

export const NB = 7; // size buckets for outline filters

export function layoutGlyphs(p: Params, shapes: Shape[], frameW: number): Glyph[] {
  const { bp } = FRAME, r = rng(p.seed), out: Glyph[] = [], L = shapes.length;
  const dotTex = p.dotRatio > 0 ? [0, 1, 2].map(i => dotTexture(p, rng(p.seed * 13 + i))) : [];
  const base = bp * (p.size / 100), bleed = p.bleed / 100, rects = bandRects(bp), N = p.count;
  const placed: [number, number, number][] = [], allow = p.overlap / 100;
  const o = p.outline / 100, sh = p.shadowOn ? Math.max(0.01, p.shadow / 100) : 0;
  const off = (sh + o * 0.5) * 100;
  const place = (cx: number, cy: number, idx: number) => {
    const sz = base * (1 + (r() * 2 - 1) * (p.sizeVar / 100));
    if (allow < 1) for (const q of placed) { const need = ((1 - allow) * (sz + q[2])) / 2 * 0.9, dx = q[0] - cx, dy = q[1] - cy; if (dx * dx + dy * dy < need * need) return; }
    placed.push([cx, cy, sz]);
    const shape = shapes[idx % L];
    const rot = p.rot === 'none' ? 0 : p.rot === 'free' ? (r() * 2 - 1) * p.rotAmt : p.rot === 'quarter' ? Math.floor(r() * 4) * 90 : (r() < 0.5 ? -1 : 1) * p.rotAmt;
    const isDot = r() * 100 < p.dotRatio, isHatch = !isDot && r() * 100 < p.hatch, isAccent = !isDot && !isHatch && r() * 100 < p.accentRatio;
    const bucket = Math.max(0, Math.min(NB - 1, Math.round(((sz / base - (1 - p.sizeVar / 100)) / Math.max(0.01, (2 * p.sizeVar) / 100)) * (NB - 1))));
    const hg = Math.max(p.hatchMin ?? 5, ((frameW * sz) / 100) * (p.hatchGap / 100)), hl = (hg * (p.hatchLine ?? 50)) / 100;
    out.push({ cx, cy, sz, rot, bucket, shape, kind: isDot ? 'dot' : isHatch ? 'hatch' : isAccent ? 'accent' : 'fill', dotTex: isDot ? dotTex[Math.floor(r() * dotTex.length)] : undefined, hatchPx: hg, hatchLinePx: hl, shadowDx: Math.cos((p.shadowAngle * Math.PI) / 180) * off, shadowDy: Math.sin((p.shadowAngle * Math.PI) / 180) * off });
  };
  if (p.layout === 'grid' || p.layout === 'rows') {
    const step = base * 0.75, jit = p.jitter / 100; let gi = 0;
    for (const [x, y, w, h] of rects) { const nx = Math.max(1, Math.round(w / step)), ny = Math.max(1, Math.round(h / step));
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (p.layout === 'rows' && (i + j) % 2) continue; place(x + ((i + 0.5) * w) / nx + (r() * 2 - 1) * step * jit * 0.5, y + ((j + 0.5) * h) / ny + (r() * 2 - 1) * step * jit * 0.5, gi++); } }
  } else if (p.layout === 'poisson') {
    const minD = base * 0.9 * (1 - allow), pts: [number, number][] = []; let tries = 0;
    while (pts.length < N && tries < N * 40) { tries++; const [x, y, w, h] = pickRect(r, rects); const mx = x + w / 2, my = y + h / 2; let cx = x + r() * w, cy = y + r() * h; cx = w < h ? mx + (cx - mx) * bleed : cx; cy = h < w ? my + (cy - my) * bleed : cy;
      let ok = true; for (const q of pts) { const dx = q[0] - cx, dy = q[1] - cy; if (dx * dx + dy * dy < minD * minD) { ok = false; break; } } if (ok) pts.push([cx, cy]); }
    pts.forEach(q => place(q[0], q[1], Math.floor(r() * L)));
  } else {
    let tries = 0;
    while (placed.length < N && tries < N * 25) { tries++; const [x, y, w, h] = pickRect(r, rects); const cx = x + r() * w, cy = y + r() * h, mx = x + w / 2, my = y + h / 2; place(w < h ? mx + (cx - mx) * bleed : cx, h < w ? my + (cy - my) * bleed : cy, Math.floor(r() * L)); }
  }
  return out;
}

export type BgGlyph = { cx: number; cy: number; sz: number; rot: number; shape: Shape };

export function layoutBgGlyphs(p: Params, bgShapes: Shape[]): BgGlyph[] {
  if (!p.bgOn || !bgShapes.length) return [];
  const { bp } = FRAME, r = rng(p.seed * 23 + 11), out: BgGlyph[] = [], L = bgShapes.length, base = bp * (p.bgSize / 100), allow = p.bgOverlap / 100;
  const rects = bandRects(bp);
  const mk = (cx: number, cy: number, sz: number) => out.push({ cx, cy, sz, rot: (r() * 2 - 1) * p.bgRot, shape: bgShapes[Math.floor(r() * L)] });
  if (p.bgRows > 0) {
    const rows = p.bgRows, rowH = bp / rows, cell = base * 0.85, jit = (p.bgRowJitter ?? 30) / 100;
    const lay = (x: number, y: number, w: number, h: number, horiz: boolean) => { const len = horiz ? w : h, nc = Math.max(1, Math.round(len / cell)), step = len / nc;
      for (let k = 0; k < rows; k++) for (let i = 0; i < nc; i++) { const along = (i + 0.5) * step + (r() * 2 - 1) * step * 0.4 * jit, across = (k + 0.5) * rowH + (r() * 2 - 1) * rowH * 0.3 * jit; mk(horiz ? x + along : x + across, horiz ? y + across : y + along, base * (1 + (r() * 2 - 1) * (p.bgSizeVar / 100))); } };
    lay(bp, 0, 100 - 2 * bp, bp, true); lay(bp, 100 - bp, 100 - 2 * bp, bp, true); lay(0, bp, bp, 100 - 2 * bp, false); lay(100 - bp, bp, bp, 100 - 2 * bp, false);
    for (const [cx, cy] of [[bp / 2, bp / 2], [100 - bp / 2, bp / 2], [bp / 2, 100 - bp / 2], [100 - bp / 2, 100 - bp / 2]]) mk(cx, cy, base);
    return out;
  }
  const placed: [number, number, number][] = [];
  for (let t = 0; t < p.bgCount * 20 && placed.length < p.bgCount; t++) {
    const [x, y, w, h] = pickRect(r, rects), cx = x + r() * w, cy = y + r() * h, sz = base * (1 + (r() * 2 - 1) * (p.bgSizeVar / 100));
    let ok = true; if (allow < 1) for (const q of placed) { const need = ((1 - allow) * (sz + q[2])) / 2 * 0.9; if (Math.hypot(q[0] - cx, q[1] - cy) < need) { ok = false; break; } }
    if (!ok) continue; placed.push([cx, cy, sz]); mk(cx, cy, sz);
  }
  return out;
}

// Pixel radii for the SVG morphology filters, per size bucket.
export function filterRadii(p: Params, frameW: number) {
  const { bp } = FRAME, base = ((frameW * bp) / 100) * (p.size / 100), v = p.sizeVar / 100;
  return Array.from({ length: NB }, (_, i) => {
    const px = base * ((1 - v) + 2 * v * (i / (NB - 1)));
    return { i, rHalo: +((px * p.outline) / 100 * 0.5).toFixed(2), rKnock: +((px * p.outline) / 100 * 0.5 * (p.knockWidth / 100)).toFixed(2), rCore: +((px * p.inner) / 100 * 0.5).toFixed(2), rHaloBB: +(px ? ((px * p.outline) / 100 * 0.5) / px : 0).toFixed(4) };
  });
}
export function bgFilterRadius(p: Params, frameW: number) {
  const w = ((frameW * FRAME.bp) / 100) * (p.bgStroke / 100);
  return { rRing: +(w * 0.5).toFixed(2), rFill: +(w * 0.5 + 0.6).toFixed(2) };
}
