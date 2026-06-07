import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
(pdfjsLib as any).GlobalWorkerOptions.workerPort = new PdfWorker();
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Upload, X, Download, FileText, Loader2, QrCode as QrCodeIcon, Plus, Trash2, Pencil, Package, CheckCircle2, Settings, Send, RotateCcw, Save } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { toast } from "@/hooks/use-toast";
import { edgePreservingUpscale } from "@/lib/upscale";
import { supabase } from "@/integrations/supabase/client";
import QRCode from "qrcode";
import JSZip from "jszip";
import { downloadZip } from "client-zip";
import { HtPngPool, type PoolTask } from "./_workers/htPngPool";
import { uploadManager, logMemory } from "@/lib/uploadManager";

const DESIGN_FORMAT_BUCKET = "design-formats";
const DESIGN_FORMAT_FOLDER = "heat-transfer";
const HT_ACTIVE_ORDER_LS_KEY = "htf:activeOrderId:v1";
const HT_SELECTED_FORMAT_LS_KEY = "htf:selectedFormatId:v1";
const HT_UI_DRAFT_PREFIX = "htf:designUiDraft:v1:";
const HT_DESIGN_DB_NAME = "heatTransferDesignDrafts";
const HT_DESIGN_STORE = "designFiles";

// ============ helpers ============

function fmtDate(v?: string | null) {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v).slice(0, 10); }
}

async function readFileAsArrayBuffer(f: File): Promise<ArrayBuffer> {
  return await f.arrayBuffer();
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Smart upscale (Lanczos3 + auto image-type pipeline). See src/lib/upscale.ts.

/**
 * Analyze a design image to recommend the best print-quality preset.
 * Heuristic: line-art / logos (few colors, transparent bg, sharp edges) → ultra.
 * Photographic / continuous-tone designs → high.
 */
async function analyzeDesignForQuality(src: string): Promise<{ preset: QualityPresetKey; reason: string }> {
  try {
    const img = await loadImage(src);
    const SAMPLE = 160;
    const ratio = Math.min(SAMPLE / img.width, SAMPLE / img.height, 1);
    const w = Math.max(8, Math.round(img.width * ratio));
    const h = Math.max(8, Math.round(img.height * ratio));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const cx = c.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    const colors = new Set<number>();
    let transparentPx = 0, edgeSum = 0, edgeCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = d[i] >> 4, g = d[i + 1] >> 4, b = d[i + 2] >> 4;
        if (d[i + 3] < 16) transparentPx++;
        if (colors.size < 4096) colors.add((r << 8) | (g << 4) | b);
        if (x < w - 1 && y < h - 1) {
          const j = i + 4, k = i + w * 4;
          edgeSum += Math.abs(d[i] - d[j]) + Math.abs(d[i] - d[k]);
          edgeCount++;
        }
      }
    }
    const total = w * h;
    const colorRatio = colors.size / total;
    const transRatio = transparentPx / total;
    const edgeAvg = edgeSum / Math.max(1, edgeCount);
    const lineArt = colorRatio < 0.08 || transRatio > 0.1;
    if (lineArt && edgeAvg > 6) return { preset: "ultra", reason: `로고/라인아트 감지 (색상 ${colors.size}, 투명 ${(transRatio * 100).toFixed(0)}%)` };
    if (lineArt) return { preset: "high", reason: `단순 그래픽 감지 (색상 ${colors.size})` };
    if (edgeAvg > 20) return { preset: "high", reason: `디테일 사진 감지 (엣지 ${edgeAvg.toFixed(1)})` };
    return { preset: "standard", reason: `연속톤 이미지 (색상 ${colors.size})` };
  } catch {
    return { preset: "high", reason: "분석 실패 — 기본값 적용" };
  }
}

type QualityPresetKey = "auto" | "standard" | "high" | "ultra" | "extreme";
const QUALITY_PRESETS: Record<Exclude<QualityPresetKey, "auto">, { label: string; desc: string; dpi: number; sharpen: boolean }> = {
  standard:  { label: "표준 200 DPI",       desc: "연속톤 / 사진 디자인. 빠른 처리.",                    dpi: 200, sharpen: false },
  high:      { label: "고품질 300 DPI",     desc: "상업 인쇄 표준. 대부분의 디자인 권장.",                dpi: 300, sharpen: true  },
  ultra:     { label: "초고품질 600 DPI",   desc: "로고 / 라인아트. 엣지 보존 샤프닝 적용.",              dpi: 600, sharpen: true  },
  extreme:   { label: "최상 1200 DPI",      desc: "대형 인쇄 / 미세 디테일. 매우 큰 파일.",               dpi: 1200, sharpen: true },
};

/** Render a PDF as a high-res alpha mask + return physical size in points (1pt = 1/72 inch). */
async function loadPdfOutline(bytes: ArrayBuffer): Promise<{
  previewUrl: string;
  maskCanvas: HTMLCanvasElement;
  widthPt: number;
  heightPt: number;
}> {
  const doc = await (pdfjsLib as any).getDocument({ data: new Uint8Array(bytes).slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  // render at 2x for crisp preview/mask
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return {
    previewUrl: canvas.toDataURL("image/png"),
    maskCanvas: canvas,
    widthPt: vp1.width,
    heightPt: vp1.height,
  };
}

/**
 * Compose a clipped design: design image is drawn inside the outline shape derived from the
 * PDF (treating dark/opaque pixels as the visible region).
 *
 * Returns a canvas at print resolution (pdf size in points * dpi/72).
 */
/**
 * Build a pure-alpha mask canvas at the target pixel size from the PDF render.
 * Expensive (drawImage + getImageData + per-pixel loop), so callers should
 * cache the result and reuse it across details that share the same format.
 */
function buildAlphaMaskCanvas(maskCanvas: HTMLCanvasElement, targetW: number, targetH: number): HTMLCanvasElement {
  const mask = document.createElement("canvas");
  mask.width = targetW;
  mask.height = targetH;
  const mctx = mask.getContext("2d")!;
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(maskCanvas, 0, 0, targetW, targetH);
  const md = mctx.getImageData(0, 0, targetW, targetH);
  const d = md.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const inside = (1 - lum) * (a / 255);
    d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
    d[i + 3] = Math.round(Math.min(1, inside) * 255);
  }
  mctx.putImageData(md, 0, 0);
  return mask;
}

async function composeClippedDesign(
  designSrc: string,
  maskCanvas: HTMLCanvasElement,
  widthPt: number,
  heightPt: number,
  dpi: number,
  transform?: { offsetXPct?: number; offsetYPct?: number; scale?: number },
  opts?: { sharpen?: boolean; preBuiltMask?: HTMLCanvasElement; preLoadedImage?: HTMLImageElement; useOriginal?: boolean },
): Promise<HTMLCanvasElement> {
  // Load image first.
  const img = opts?.preLoadedImage ?? (await loadImage(designSrc));

  // Frame shape/size is ALWAYS fixed to the uploaded frame (mask) geometry.
  // - useOriginal: use the mask's native pixel size (no DPI upscale).
  // - otherwise:   scale to widthPt/heightPt × dpi (keeps frame aspect).
  const targetW = opts?.useOriginal
    ? Math.max(64, maskCanvas.width)
    : Math.max(64, Math.round((widthPt / 72) * dpi));
  const targetH = opts?.useOriginal
    ? Math.max(64, maskCanvas.height)
    : Math.max(64, Math.round((heightPt / 72) * dpi));

  // 1) alpha mask — reuse cached one when provided & matches size, else rebuild at target size.
  const mask = opts?.preBuiltMask && opts.preBuiltMask.width === targetW && opts.preBuiltMask.height === targetH
    ? opts.preBuiltMask
    : buildAlphaMaskCanvas(maskCanvas, targetW, targetH);

  // 2) draw design centered, cover-fit to mask, with user transform (offset + scale, aspect kept)
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";

  const userScale = transform?.scale ?? 1;
  const offXPct = transform?.offsetXPct ?? 0;
  const offYPct = transform?.offsetYPct ?? 0;
  // Always cover-fit so the frame keeps its uploaded shape.
  const baseScale = Math.max(targetW / img.width, targetH / img.height);
  const scale = baseScale * userScale;
  const dw = Math.max(1, Math.round(img.width * scale));
  const dh = Math.max(1, Math.round(img.height * scale));
  const dx = Math.round((targetW - dw) / 2 + (offXPct / 100) * targetW);
  const dy = Math.round((targetH - dh) / 2 + (offYPct / 100) * targetH);
  if (opts?.sharpen && !opts?.useOriginal && (dw > img.width || dh > img.height)) {
    const sharp = edgePreservingUpscale(img, dw, dh);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(sharp, dx, dy);
    octx.imageSmoothingEnabled = true;
  } else {
    octx.drawImage(img, dx, dy, dw, dh);
  }


  // 3) clip with mask alpha
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(mask, 0, 0);
  octx.globalCompositeOperation = "source-over";

  return out;
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("blob fail"))), "image/png");
  });
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ============ footer (UID + QR) ============

export interface FooterCfg {
  enabled: boolean;
  qrSizeMm: number;        // QR 한 변 (mm)
  textSizeMm: number;      // 고유번호 텍스트 높이 (mm)
  offsetXPct: number;      // 수평 정렬 -100(좌) ~ 0(중앙) ~ 100(우)
  bottomPaddingMm: number; // 하단 여백 (mm)
  gapMm: number;           // QR-텍스트 간격 (mm)
}

export const DEFAULT_FOOTER_CFG: FooterCfg = {
  enabled: true,
  qrSizeMm: 10,
  textSizeMm: 4,
  offsetXPct: 0,
  bottomPaddingMm: 2,
  gapMm: 3,
};

/**
 * Append a footer band (QR + design UID text, horizontally aligned) underneath
 * a composed design canvas. Returns a new canvas with the same width.
 */
async function composeWithFooter(
  base: HTMLCanvasElement,
  widthPt: number,
  _dpi: number,
  designUid: string,
  cfg: FooterCfg,
  meta?: { tshirtType?: string; tshirtColor?: string; tshirtSize?: string },
): Promise<HTMLCanvasElement> {
  if (!cfg.enabled) return base;
  const widthMm = (widthPt / 72) * 25.4;
  const pxPerMm = base.width / widthMm;
  const qrPx = Math.max(1, Math.round(cfg.qrSizeMm * pxPerMm));
  const textPx = Math.max(1, Math.round(cfg.textSizeMm * pxPerMm));
  const gapPx = Math.max(0, Math.round(cfg.gapMm * pxPerMm));
  const padPx = Math.max(0, Math.round(cfg.bottomPaddingMm * pxPerMm));

  // Build meta line: 티셔츠 종류 · 컬러 · 사이즈
  const metaParts = [meta?.tshirtType, meta?.tshirtColor, meta?.tshirtSize]
    .map((v) => (v ?? "").toString().trim())
    .filter(Boolean);
  const metaText = metaParts.join(" · ");
  const metaTextPx = Math.max(1, Math.round(cfg.textSizeMm * 0.85 * pxPerMm));
  const bandH = Math.max(qrPx, textPx, metaText ? metaTextPx : 0) + padPx * 2;

  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, designUid || " ", { width: qrPx, margin: 0 });

  const out = document.createElement("canvas");
  out.width = base.width;
  out.height = base.height + bandH;
  const ctx = out.getContext("2d")!;
  // 바탕은 투명 유지 (이미지/푸터 외 모든 영역 transparent)
  ctx.clearRect(0, 0, out.width, out.height);
  ctx.drawImage(base, 0, 0);

  ctx.fillStyle = "#000000";
  ctx.font = `${textPx}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = "middle";
  const textW = Math.ceil(ctx.measureText(designUid || "").width);
  const groupW = qrPx + gapPx + textW;

  const freeX = Math.max(0, out.width - groupW);
  const t = (cfg.offsetXPct + 100) / 200;
  const groupX = Math.round(freeX * t);
  const bandTop = base.height + padPx;
  const groupCenterY = bandTop + Math.max(qrPx, textPx) / 2;

  ctx.drawImage(qrCanvas, groupX, Math.round(groupCenterY - qrPx / 2));
  ctx.fillText(designUid || "", groupX + qrPx + gapPx, groupCenterY);

  if (metaText) {
    ctx.font = `${metaTextPx}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textBaseline = "middle";
    const metaX = groupX + qrPx + gapPx + textW + gapPx;
    ctx.fillText(metaText, metaX, groupCenterY);
  }

  return out;
}

// CRC32 for PNG chunk
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

// Inject a pHYs chunk into a PNG blob so apps like Illustrator read the correct physical size (DPI).
async function pngWithDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // PNG signature: 8 bytes; first chunk is IHDR (length 13 + 4 + 4 + 13 = ...). We insert pHYs right after IHDR.
  // Find end of IHDR chunk
  let pos = 8;
  const dv = new DataView(buf.buffer);
  const ihdrLen = dv.getUint32(pos);
  const ihdrEnd = pos + 4 + 4 + ihdrLen + 4; // length + type + data + crc
  // ppm = pixels per meter; 1 inch = 0.0254 m
  const ppm = Math.round(dpi / 0.0254);
  const chunkData = new Uint8Array(9);
  const cdv = new DataView(chunkData.buffer);
  cdv.setUint32(0, ppm);
  cdv.setUint32(4, ppm);
  chunkData[8] = 1; // unit: meters
  const type = new Uint8Array([0x70, 0x48, 0x59, 0x73]); // 'pHYs'
  const crcInput = new Uint8Array(type.length + chunkData.length);
  crcInput.set(type, 0); crcInput.set(chunkData, type.length);
  const crc = crc32(crcInput);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const xdv = new DataView(chunk.buffer);
  xdv.setUint32(0, 9);
  chunk.set(type, 4);
  chunk.set(chunkData, 8);
  xdv.setUint32(17, crc);
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(buf.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return new Blob([out], { type: "image/png" });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============ types ============

interface OrderRow {
  id: string;
  orderNo: string;          // external_order_id (작업번호)
  receivedAt: string;
  dueDate: string;
  twinker: string;
  workQty: number;
  designQty: number;
  logoUrl: string | null;
  items: any[];
  raw: any;
}

interface DesignDetail {
  serial: number;
  orderNo: string;
  designUid: string;        // "{orderNo}-{idx+1}"
  designSrc: string | null;
  tshirtType: string;
  tshirtColor: string;
  tshirtSize: string;
  grade: string;
}

// Normalize grade values from various sources (full names, abbreviations, colors)
function resolveGrade(item: any, order?: any): string {
  const raw = String(
    item?.grade ??
    item?.card_grade ??
    order?.source_data?.grade ??
    order?.source_data?.card_grade ??
    order?.grade ??
    ""
  ).trim().toUpperCase();
  if (!raw) return "COMMON";
  const known = ["COMMON", "RARE", "EPIC", "LEGEND"];
  if (known.includes(raw)) return raw;
  const abbrMap: Record<string, string> = {
    C: "COMMON", R: "RARE", E: "EPIC", L: "LEGEND",
    COM: "COMMON", RAR: "RARE", EPI: "EPIC", LEG: "LEGEND", LGD: "LEGEND",
    BLACK: "COMMON", SILVER: "RARE", GOLD: "EPIC", HOLOGRAM: "LEGEND", HOLO: "LEGEND",
  };
  return abbrMap[raw] ?? "COMMON";
}

function gradeBadgeVariant(grade: string): "secondary" | "default" | "outline" | "destructive" {
  switch (grade) {
    case "LEGEND": return "destructive";
    case "EPIC": return "default";
    case "RARE": return "secondary";
    default: return "outline";
  }
}

type PngJobRow = {
  item_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  file_url?: string | null;
  error_message?: string | null;
  last_heartbeat?: string | null;
  completed_at?: string | null;
};

type UploadIssue = {
  index: number;
  fileName: string;
  reason: string;
};

const HT_UPLOAD_CONCURRENCY = 5;
const HT_UPLOAD_TIMEOUT_MS = 180_000;
const HT_UPLOAD_MAX_ATTEMPTS = 3;

type HtDesignUiDraft = {
  quality?: QualityPresetKey;
  offsetX?: number;
  offsetY?: number;
  designScale?: number;
  testUid?: string;
  dpi?: number;
  useOriginalRes?: boolean;
};

type HtPersistedDesign = {
  orderNo: string;
  dataUrl: string;
  name: string;
  updatedAt: string;
};

function readHtDesignUiDraft(orderNo: string): HtDesignUiDraft {
  try {
    const raw = localStorage.getItem(`${HT_UI_DRAFT_PREFIX}${orderNo}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeHtDesignUiDraft(orderNo: string, patch: HtDesignUiDraft) {
  try {
    const prev = readHtDesignUiDraft(orderNo);
    localStorage.setItem(`${HT_UI_DRAFT_PREFIX}${orderNo}`, JSON.stringify({ ...prev, ...patch }));
  } catch {}
}

function openHtDesignDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HT_DESIGN_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HT_DESIGN_STORE)) db.createObjectStore(HT_DESIGN_STORE, { keyPath: "orderNo" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("작업 파일 저장소를 열 수 없습니다."));
  });
}

async function readHtPersistedDesign(orderNo: string): Promise<HtPersistedDesign | null> {
  const db = await openHtDesignDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HT_DESIGN_STORE, "readonly");
    const req = tx.objectStore(HT_DESIGN_STORE).get(orderNo);
    req.onsuccess = () => resolve((req.result as HtPersistedDesign | undefined) || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveHtPersistedDesign(orderNo: string, dataUrl: string, name: string) {
  const db = await openHtDesignDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HT_DESIGN_STORE, "readwrite");
    tx.objectStore(HT_DESIGN_STORE).put({ orderNo, dataUrl, name, updatedAt: new Date().toISOString() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function deleteHtPersistedDesign(orderNo: string) {
  const db = await openHtDesignDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HT_DESIGN_STORE, "readwrite");
    tx.objectStore(HT_DESIGN_STORE).delete(orderNo);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ============ page ============

export default function HeatTransferFactory() {
  const { t } = useLang();
  const { data: dbOrders } = useOrders();

  const orders: OrderRow[] = useMemo(() => {
    const out: OrderRow[] = [];
    for (const o of (dbOrders || []) as any[]) {
      const items = (o.source_data?.items as any[]) || [];
      out.push({
        id: o.id,
        orderNo: o.external_order_id,
        receivedAt: fmtDate(o.created_at),
        dueDate: fmtDate(o.project_completed_at),
        twinker: o.recipient_name || items[0]?.twinker || "",
        workQty: o.quantity || items.length || 1,
        designQty: items.length || 1,
        logoUrl: o.logo_url || null,
        items,
        raw: o,
      });
    }
    return out;
  }, [dbOrders]);

  // Multiple size-based design formats.
  // Filename convention: `fmt__{encodedSizeLabel}__{ts}__{safeName}.pdf`
  type FormatEntry = {
    id: string;
    sizeLabel: string;
    name: string;
    previewUrl: string;
    maskCanvas: HTMLCanvasElement;
    widthPt: number;
    heightPt: number;
  };
  const [formats, setFormats] = useState<FormatEntry[]>([]);
  const [selectedFormatId, setSelectedFormatIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(HT_SELECTED_FORMAT_LS_KEY); } catch { return null; }
  });
  const [formatsLoading, setFormatsLoading] = useState(false);

  const setSelectedFormatId = (id: string | null) => {
    setSelectedFormatIdState(id);
    try {
      if (id) localStorage.setItem(HT_SELECTED_FORMAT_LS_KEY, id);
      else localStorage.removeItem(HT_SELECTED_FORMAT_LS_KEY);
    } catch {}
  };

  const runDesignFormatStorageAction = async (form: FormData) => {
    const { data, error } = await supabase.functions.invoke("design-format-storage", { body: form });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "디자인 포맷 저장소 작업에 실패했습니다.");
    return data as { ok: true; id?: string; newId?: string; path?: string; removed?: unknown[] };
  };

  const parseSizeFromName = (storageName: string): { sizeLabel: string; original: string } => {
    const parts = storageName.split("__");
    if (parts.length >= 4 && parts[0] === "fmt") {
      try {
        return { sizeLabel: decodeURIComponent(parts[1]), original: parts.slice(3).join("__") };
      } catch {
        return { sizeLabel: parts[1], original: parts.slice(3).join("__") };
      }
    }
    return { sizeLabel: "기본", original: storageName };
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFormatsLoading(true);
      try {
        const { data: list, error } = await supabase.storage
          .from(DESIGN_FORMAT_BUCKET)
          .list(DESIGN_FORMAT_FOLDER, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
        if (cancelled) return;
        if (error || !list || list.length === 0) { setFormats([]); return; }

        const loadOne = async (fileName: string): Promise<FormatEntry | null> => {
          try {
            const { data: blob, error: dlErr } = await supabase.storage
              .from(DESIGN_FORMAT_BUCKET)
              .download(`${DESIGN_FORMAT_FOLDER}/${fileName}`);
            if (dlErr || !blob) return null;
            const buf = await blob.arrayBuffer();
            const r = await loadPdfOutline(buf);
            const { sizeLabel, original } = parseSizeFromName(fileName);
            return { id: fileName, sizeLabel, name: original, ...r };
          } catch {
            return null;
          }
        };

        // Parallel load with bounded concurrency; stream results into state as they arrive.
        const CONCURRENCY = 6;
        const queue = list.map((it) => it.name);
        let firstSelected = false;
        const worker = async () => {
          while (!cancelled) {
            const name = queue.shift();
            if (!name) return;
            const entry = await loadOne(name);
            if (cancelled || !entry) continue;
            setFormats((prev) => [...prev, entry]);
            if (!firstSelected) {
              firstSelected = true;
              setSelectedFormatIdState((prev) => {
                const next = prev || entry.id;
                if (!prev) {
                  try { localStorage.setItem(HT_SELECTED_FORMAT_LS_KEY, next); } catch {}
                }
                return next;
              });
            }
          }
        };
        // Reset before streaming
        setFormats([]);
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      } finally {
        if (!cancelled) setFormatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleAddFormat = async (sizeLabel: string, f: File) => {
    const label = sizeLabel.trim();
    if (!label) { toast({ title: "사이즈를 입력하세요", variant: "destructive" }); return; }
    setFormatsLoading(true);
    try {
      const buf = await readFileAsArrayBuffer(f);
      const r = await loadPdfOutline(buf);
      const form = new FormData();
      form.append("action", "upload");
      form.append("sizeLabel", label);
      form.append("file", f, f.name);
      const result = await runDesignFormatStorageAction(form);
      const storedName = result.id;
      if (!storedName) throw new Error("저장된 파일 정보를 확인할 수 없습니다.");
      const entry: FormatEntry = { id: storedName, sizeLabel: label, name: f.name, ...r };
      setFormats((prev) => [...prev, entry]);
      setSelectedFormatId(storedName);
      toast({ title: "디자인 포맷 추가됨", description: `${label} · ${f.name}` });
    } catch (e: any) {
      toast({ title: "저장 실패", description: e?.message || "관리자만 변경할 수 있습니다.", variant: "destructive" });
    } finally {
      setFormatsLoading(false);
    }
  };

  const handleRemoveFormat = async (id: string) => {
    setFormatsLoading(true);
    try {
      const form = new FormData();
      form.append("action", "delete");
      form.append("id", id);
      await runDesignFormatStorageAction(form);
      setFormats((prev) => {
        const next = prev.filter((x) => x.id !== id);
        if (selectedFormatId === id) setSelectedFormatId(next[0]?.id || null);
        return next;
      });
      toast({ title: "디자인 포맷 삭제됨" });
    } catch (e: any) {
      console.error("[design-format] remove failed:", e);
      toast({ title: "삭제 실패", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setFormatsLoading(false);
    }
  };

  const handleRenameFormat = async (id: string, newSizeLabel: string) => {
    const label = newSizeLabel.trim();
    if (!label) { toast({ title: "사이즈를 입력하세요", variant: "destructive" }); return; }
    const entry = formats.find((f) => f.id === id);
    if (!entry) return;
    if (entry.sizeLabel === label) return;
    setFormatsLoading(true);
    try {
      const form = new FormData();
      form.append("action", "rename");
      form.append("id", id);
      form.append("sizeLabel", label);
      const result = await runDesignFormatStorageAction(form);
      const newId = result.newId;
      if (!newId) throw new Error("변경된 파일 정보를 확인할 수 없습니다.");
      setFormats((prev) => prev.map((f) => f.id === id ? { ...f, id: newId, sizeLabel: label } : f));
      if (selectedFormatId === id) setSelectedFormatId(newId);
      toast({ title: "사이즈 변경됨", description: label });
    } catch (e: any) {
      console.error("[design-format] rename failed:", e);
      toast({ title: "변경 실패", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setFormatsLoading(false);
    }
  };

  const handleReplaceFormat = async (id: string, f: File) => {
    const entry = formats.find((x) => x.id === id);
    if (!entry) return;
    setFormatsLoading(true);
    try {
      const buf = await readFileAsArrayBuffer(f);
      const r = await loadPdfOutline(buf);
      const form = new FormData();
      form.append("action", "upload");
      form.append("sizeLabel", entry.sizeLabel);
      form.append("file", f, f.name);
      const result = await runDesignFormatStorageAction(form);
      const newId = result.id;
      if (!newId) throw new Error("저장된 파일 정보를 확인할 수 없습니다.");
      try {
        const del = new FormData();
        del.append("action", "delete");
        del.append("id", id);
        await runDesignFormatStorageAction(del);
      } catch (e) {
        console.warn("[design-format] old file cleanup failed:", e);
      }
      setFormats((prev) => prev.map((x) => x.id === id ? { id: newId, sizeLabel: entry.sizeLabel, name: f.name, ...r } : x));
      if (selectedFormatId === id) setSelectedFormatId(newId);
      toast({ title: "파일 변경됨", description: `${entry.sizeLabel} · ${f.name}` });
    } catch (e: any) {
      console.error("[design-format] replace failed:", e);
      toast({ title: "파일 변경 실패", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setFormatsLoading(false);
    }
  };

  const outline = formats.find((f) => f.id === selectedFormatId) || null;

  useEffect(() => {
    if (formatsLoading) return;
    if (formats.length === 0 && selectedFormatId) setSelectedFormatId(null);
    if (formats.length > 0 && (!selectedFormatId || !formats.some((f) => f.id === selectedFormatId))) {
      setSelectedFormatId(formats[0].id);
    }
  }, [formatsLoading, formats, selectedFormatId]);

  const [activeOrderId, setActiveOrderId] = useState<string | null>(() => {
    try { return localStorage.getItem(HT_ACTIVE_ORDER_LS_KEY); } catch { return null; }
  });
  const activeOrder = orders.find((o) => o.id === activeOrderId) || null;

  useEffect(() => {
    if (activeOrderId && !activeOrder && orders.length > 0) {
      setActiveOrderId(null);
      try { localStorage.removeItem(HT_ACTIVE_ORDER_LS_KEY); } catch {}
    }
  }, [activeOrderId, activeOrder, orders.length]);

  const openOrder = (id: string | null) => {
    setActiveOrderId(id);
    try {
      if (id) localStorage.setItem(HT_ACTIVE_ORDER_LS_KEY, id);
      else localStorage.removeItem(HT_ACTIVE_ORDER_LS_KEY);
    } catch {}
  };

  return (
    <div>
      <PageHeader title={t("menu.outHeatTransfer") || "열전사 디자인 공장"} description="PDF 외곽선 기반 디자인 시안 + QR코드 발주" />
      <div className="p-6 space-y-4">
        {!activeOrder ? (
          <>
            <DesignFormatBox
              formats={formats}
              selectedId={selectedFormatId}
              onSelect={setSelectedFormatId}
              loading={formatsLoading}
              onAdd={handleAddFormat}
              onRemove={handleRemoveFormat}
              onRename={handleRenameFormat}
              onReplace={handleReplaceFormat}
            />
            <OrderListCard orders={orders} onOpen={openOrder} />
          </>
        ) : (
          <OrderDetail
            order={activeOrder}
            outline={outline}
            formats={formats}
            onBack={() => openOrder(null)}
          />

        )}
      </div>
    </div>
  );
}

// ============ design format box ============

function DesignFormatBox({
  formats, selectedId, onSelect, loading, onAdd, onRemove, onRename, onReplace,
}: {
  formats: Array<{ id: string; sizeLabel: string; name: string; previewUrl: string; widthPt: number; heightPt: number }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  onAdd: (sizeLabel: string, f: File) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, newSizeLabel: string) => void;
  onReplace: (id: string, f: File) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [newSize, setNewSize] = useState("");
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> 디자인 포맷 설정 (사이즈별)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add row */}
        <div className="rounded border border-dashed p-3 space-y-2 bg-muted/20">
          <Label className="text-xs">새 사이즈 추가</Label>
          {!adding ? (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={loading}>
              <Plus className="w-4 h-4 mr-1" /> 추가
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                placeholder="사이즈 (예: S, M, L, 100×120mm)"
                value={newSize}
                onChange={(e) => setNewSize(e.target.value)}
                className="h-9 w-64"
              />
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    onAdd(newSize, f);
                    setNewSize("");
                    setAdding(false);
                  }
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                onClick={() => {
                  if (!newSize.trim()) { toast({ title: "사이즈를 입력하세요", variant: "destructive" }); return; }
                  inputRef.current?.click();
                }}
                disabled={loading}
              >
                <Upload className="w-4 h-4 mr-1" /> PDF 업로드
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewSize(""); }}>취소</Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">사이즈별로 외곽선 PDF를 등록하세요. 각 PDF의 첫 페이지가 외곽선으로 사용됩니다.</p>
        </div>

        {/* Format list */}
        {loading && formats.length === 0 ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : formats.length === 0 ? (
          <p className="text-xs text-muted-foreground">등록된 포맷이 없습니다. 위에서 추가해 주세요.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {formats.map((f) => {
              const selected = f.id === selectedId;
              const wMm = (f.widthPt / 72 * 25.4).toFixed(1);
              const hMm = (f.heightPt / 72 * 25.4).toFixed(1);
              return (
                <div
                  key={f.id}
                  onClick={() => onSelect(f.id)}
                  className={`relative rounded border p-3 cursor-pointer transition-colors ${selected ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:bg-muted/40"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {editingId === f.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Input
                            autoFocus
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                onRename(f.id, editingValue);
                                setEditingId(null);
                              } else if (e.key === "Escape") {
                                setEditingId(null);
                              }
                            }}
                            className="h-7 text-xs"
                          />
                          <Button size="sm" variant="default" className="h-7 px-2 text-xs"
                            onClick={() => { onRename(f.id, editingValue); setEditingId(null); }}>저장</Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                            onClick={() => setEditingId(null)}>취소</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Badge variant={selected ? "default" : "secondary"}>{f.sizeLabel}</Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); setEditingId(f.id); setEditingValue(f.sizeLabel); }}
                            disabled={loading}
                            title="사이즈 변경"
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          {selected && <span className="text-[10px] text-primary font-medium">선택됨</span>}
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-1 truncate" title={f.name}>{f.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{wMm}×{hMm}mm</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(e) => { e.stopPropagation(); setReplaceTargetId(f.id); replaceInputRef.current?.click(); }}
                        disabled={loading}
                        title="파일 변경"
                      >
                        <Upload className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(e) => { e.stopPropagation(); onRemove(f.id); }}
                        disabled={loading}
                        title="삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 w-full h-32 rounded bg-muted/30 flex items-center justify-center overflow-hidden">
                    <img src={f.previewUrl} alt={f.sizeLabel} className="max-w-full max-h-full object-contain" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <input
          ref={replaceInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            const id = replaceTargetId;
            if (f && id) onReplace(id, f);
            setReplaceTargetId(null);
            e.target.value = "";
          }}
        />
      </CardContent>
    </Card>
  );
}

// ============ order list ============

function OrderListCard({ orders, onOpen }: { orders: OrderRow[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">주문 목록</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">순번</TableHead>
              <TableHead>작업번호</TableHead>
              <TableHead>주문접수일</TableHead>
              <TableHead>납기일</TableHead>
              <TableHead>받을사람</TableHead>
              <TableHead className="text-right">작업수량</TableHead>
              <TableHead className="text-right">디자인수량</TableHead>
              <TableHead className="text-right w-28">상세보기</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o, idx) => (
              <TableRow key={o.id}>
                <TableCell>{idx + 1}</TableCell>
                <TableCell className="font-mono">{o.orderNo}</TableCell>
                <TableCell>{o.receivedAt}</TableCell>
                <TableCell>{o.dueDate}</TableCell>
                <TableCell>{o.twinker}</TableCell>
                <TableCell className="text-right">{o.workQty}</TableCell>
                <TableCell className="text-right">{o.designQty}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => onOpen(o.id)}>상세보기</Button>
                </TableCell>
              </TableRow>
            ))}
            {orders.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">—</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============ order detail ============

type OutlineFormat = { previewUrl: string; maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number; name: string };
type SizedFormat = OutlineFormat & { id: string; sizeLabel: string };

function normalizeSize(s: string) {
  return (s || "").toString().trim().toUpperCase().replace(/\s+/g, "");
}

export function pickFormatForSize(formats: SizedFormat[], size: string, fallback: OutlineFormat | null): OutlineFormat | null {
  const target = normalizeSize(size);
  if (target) {
    const exact = formats.find((f) => normalizeSize(f.sizeLabel) === target);
    if (exact) return exact;
    const partial = formats.find((f) => {
      const lbl = normalizeSize(f.sizeLabel);
      return lbl && (lbl === target || lbl.includes(target) || target.includes(lbl));
    });
    if (partial) return partial;
  }
  return fallback;
}

function OrderDetail({
  order, outline, formats, onBack,
}: {
  order: OrderRow;
  outline: OutlineFormat | null;
  formats: SizedFormat[];
  onBack: () => void;
}) {
  const [testDesign, setTestDesign] = useState<string | null>(null);
  const [testName, setTestName] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setTestDesign(null);
    setTestName("");
    (async () => {
      try {
        const saved = await readHtPersistedDesign(order.orderNo);
        if (!cancelled && saved?.dataUrl) {
          setTestDesign(saved.dataUrl);
          setTestName(saved.name || "저장된 테스트 디자인");
        }
      } catch {
        if (!cancelled) toast({ title: "저장된 작업 파일을 불러오지 못했습니다", variant: "destructive" });
      }
    })();
    return () => { cancelled = true; };
  }, [order.orderNo]);

  const details: DesignDetail[] = useMemo(() => {
    const arr: DesignDetail[] = [];
    const n = Math.max(order.items.length, 1);
    for (let i = 0; i < n; i++) {
      const it: any = order.items[i] || {};
      arr.push({
        serial: i + 1,
        orderNo: order.orderNo,
        designUid: `${order.orderNo}-${i + 1}`,
        designSrc: order.logoUrl || testDesign,
        tshirtType: String(it.tshirt_type ?? "").trim(),
        tshirtColor: String(it.tshirt_color ?? "").trim(),
        tshirtSize: String(it.tshirt_size ?? "").trim(),
        grade: resolveGrade(it, order.raw),
      });
    }
    return arr;
  }, [order, testDesign]);

  const [resetKey, setResetKey] = useState(0);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const handleResetAll = async () => {
    try { localStorage.removeItem(`${HT_UI_DRAFT_PREFIX}${order.orderNo}`); } catch {}
    try { localStorage.removeItem(`heatTransfer.progress.v1.${order.orderNo}`); } catch {}
    try { await deleteHtPersistedDesign(order.orderNo); } catch {}
    setTestDesign(null);
    setTestName("");
    setResetKey((k) => k + 1);
    setResetConfirmOpen(false);
    toast({ title: "초기화 완료", description: "현재 작업번호의 모든 작업 내용이 삭제되었습니다." });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> 목록으로</Button>
          <h2 className="text-base font-semibold">작업번호 <span className="font-mono">{order.orderNo}</span></h2>
        </div>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setResetConfirmOpen(true)}>
          <RotateCcw className="w-4 h-4 mr-1" /> 초기화
        </Button>
      </div>

      <OrderProgressBox key={`progress-${resetKey}`} order={order} details={details} outline={outline} formats={formats} testDesign={testDesign} />

      <WorkOrderInfoBox order={order} outlinePreview={outline?.previewUrl} />

      <Tabs key={`tabs-${resetKey}`} defaultValue="design">
        <TabsList>
          <TabsTrigger value="design">디자인 시안 설정</TabsTrigger>
          <TabsTrigger value="qr">큐알코드 시안</TabsTrigger>
        </TabsList>
        <TabsContent value="design">
          <DesignTab
            order={order} details={details} outline={outline} formats={formats}
            testDesign={testDesign} setTestDesign={setTestDesign}
            testName={testName} setTestName={setTestName}
          />
        </TabsContent>
        <TabsContent value="qr">
          <QrTab details={details} />
        </TabsContent>
      </Tabs>

      <OrderDetailList details={details} outline={outline} formats={formats} />

      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>작업 상태 초기화</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            현재 작업번호의 모든 작업 내용(업로드한 테스트 디자인, 위치/크기 조정, 발주 진행 상태 등)이 삭제됩니다.<br />
            정말 처음부터 다시 작업하시겠습니까?
          </p>
          <DialogFooter className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => setResetConfirmOpen(false)}>취소</Button>
            <Button size="sm" variant="destructive" onClick={handleResetAll}>
              <RotateCcw className="w-4 h-4 mr-1" /> 초기화
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


interface HtWorkOrderData {
  company: string; orderNo: string; orderDate: string; deliveryDate: string;
  total: number;
  recipient: string; phone: string; address: string; notes: string;
}

function TxtField({ label, v, set, type = "text" }: { label: string; v: string; set: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={v} onChange={(e) => set(e.target.value)} className="h-9" />
    </div>
  );
}

function buildHtWorkOrderHtml(wo: HtWorkOrderData, outlinePreview?: string | null, opts?: { autoPrint?: boolean }): string {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const outlineBlock = outlinePreview
    ? `<h2>作业结果物(首件)</h2><div class="outline"><img src="${outlinePreview}" alt="first-result" /></div>`
    : "";
  const printBtn = opts?.autoPrint ? `<div class="no-print"><button onclick="window.print()">打印 / 保存PDF</button></div>` : "";
  const printScript = opts?.autoPrint ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>` : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>作业指示书 - ${esc(wo.orderNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "PingFang SC", "Microsoft YaHei", "SimHei", "Noto Sans SC", sans-serif; color:#111; margin:0; padding:0; background:#fff; }
  .page { padding: 12mm; }
  h1 { font-size: 22pt; text-align:center; margin: 0 0 4mm; letter-spacing: 8px; border-bottom: 2px solid #111; padding-bottom: 4mm; }
  .meta { display:flex; justify-content:space-between; font-size: 9pt; color:#555; margin-bottom: 6mm; }
  table { width:100%; border-collapse: collapse; font-size: 10pt; }
  table th, table td { border: 1px solid #333; padding: 2.5mm 3mm; vertical-align: middle; }
  table th { background:#f2f2f2; font-weight:600; width: 22%; text-align:left; }
  .qty th, .qty td { text-align:center; }
  .qty th { background:#f7f7f7; }
  .notes { min-height: 22mm; white-space: pre-wrap; }
  h2 { font-size: 12pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  .outline { border:1px solid #333; padding: 4mm; text-align:center; }
  .outline img { max-width: 100%; max-height: 80mm; object-fit: contain; }
  .sig { margin-top: 10mm; display:flex; justify-content:flex-end; gap: 10mm; font-size: 10pt; }
  .sig div { border-top:1px solid #333; padding-top:2mm; min-width: 40mm; text-align:center; }
  @media print { .no-print { display:none; } .page { padding: 0; } }
  .no-print { position:fixed; top:8px; right:8px; }
  .no-print button { padding: 8px 14px; font-size: 13px; cursor:pointer; }
</style></head>
<body>
  ${printBtn}
  <div class="page">
    <h1>作 业 指 示 书</h1>
    <div class="meta"><span>发包方:${esc(wo.company)}</span><span>打印日期:${today}</span></div>
    <table>
      <tr><th>发包公司</th><td>${esc(wo.company)}</td><th>作业编号</th><td>${esc(wo.orderNo)}</td></tr>
      <tr><th>下单日期</th><td>${esc(wo.orderDate)}</td><th>交货日期</th><td>${esc(wo.deliveryDate)}</td></tr>
      <tr><th>收件人</th><td>${esc(wo.recipient)}</td><th>联系电话</th><td>${esc(wo.phone)}</td></tr>
      <tr><th>收货地址</th><td colspan="3">${esc(wo.address)}</td></tr>
    </table>
    <h2>作业数量</h2>
    <table class="qty"><tr><th>总数量</th></tr><tr><td><strong>${esc(wo.total)}</strong></td></tr></table>
    <h2>订单特殊事项</h2>
    <table><tr><td class="notes">${esc(wo.notes) || "&nbsp;"}</td></tr></table>
    ${outlineBlock}
    <div class="sig"><div>负责人</div><div>审批</div></div>
  </div>
  ${printScript}
</body></html>`;
}

function printHtWorkOrder(wo: HtWorkOrderData, outlinePreview?: string | null) {
  const html = buildHtWorkOrderHtml(wo, outlinePreview, { autoPrint: true });
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", description: "팝업을 허용해주세요", variant: "destructive" }); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// ===== 작업지시서 데이터 계산 (WorkOrderInfoBox와 동일한 fallback 로직) =====
function computeHtWorkOrderData(order: OrderRow): HtWorkOrderData {
  const sd = order.raw?.source_data || {};
  let siliconDefaults: any = null;
  if (typeof window !== "undefined") {
    try {
      const exact = localStorage.getItem(`silicon.workOrder.v1.${order.orderNo}`);
      if (exact) siliconDefaults = JSON.parse(exact);
      else {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith("silicon.workOrder.v1.")) continue;
          const v = localStorage.getItem(k);
          if (v) { try { siliconDefaults = JSON.parse(v); } catch {} }
        }
      }
    } catch {}
  }
  const defaults: HtWorkOrderData = {
    company: "TWINMETA",
    orderNo: order.orderNo,
    orderDate: order.receivedAt,
    deliveryDate: order.dueDate,
    total: order.workQty,
    recipient: siliconDefaults?.recipient || order.raw?.recipient_name || "TWINMETA",
    phone: siliconDefaults?.phone || order.raw?.recipient_phone || "18562757070",
    address: siliconDefaults?.address || order.raw?.shipping_address || "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
    notes: sd.notes || sd.special_notes || sd.memo || "",
  };
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(`heatTransfer.workOrder.v1.${order.orderNo}`) : null;
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

// ===== 위챗 webhook helpers =====
const HT_WECHAT_WEBHOOK_LS_KEY = "wechat.webhook.heatTransfer";
const HT_WECHAT_HOOKS_SHARED_KEY = "outsource.wechatWebhooks.v1";
function readHtWebhook(): string {
  try {
    const shared = localStorage.getItem(HT_WECHAT_HOOKS_SHARED_KEY);
    if (shared) {
      const obj = JSON.parse(shared);
      // 발주이력관리(OutsourceHistory)는 'heat' 키로 저장 — 우선 매칭, 구버전 'heatTransfer'는 폴백
      const v = (obj?.heat ?? obj?.heatTransfer ?? "").toString().trim();
      if (v) return v;
    }
  } catch {}
  try { return (localStorage.getItem(HT_WECHAT_WEBHOOK_LS_KEY) || "").trim(); } catch { return ""; }
}
function writeHtWebhook(url: string) {
  const v = url.trim();
  try { localStorage.setItem(HT_WECHAT_WEBHOOK_LS_KEY, v); } catch {}
  try {
    const raw = localStorage.getItem(HT_WECHAT_HOOKS_SHARED_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    // 두 키 모두 기록 — 발주이력관리/구버전 모두 호환
    obj.heat = v;
    obj.heatTransfer = v;
    localStorage.setItem(HT_WECHAT_HOOKS_SHARED_KEY, JSON.stringify(obj));
  } catch {}
}

// ===== HTML -> A4 PDF =====
async function renderHtmlToPdfBytes(html: string): Promise<Uint8Array> {
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "210mm";
  iframe.style.height = "297mm";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => { iframe.onload = () => resolve(); iframe.srcdoc = html; });
    const doc = iframe.contentDocument!;
    await (doc as any).fonts?.ready?.catch?.(() => {});
    const imgs = Array.from(doc.images);
    await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = () => r(null); })));
    await new Promise((r) => setTimeout(r, 150));
    const canvas = await html2canvas(doc.body, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = 210, pageH = 297;
    const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
    const imgW = canvas.width * ratio;
    const imgH = canvas.height * ratio;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(dataUrl, "JPEG", (pageW - imgW) / 2, 0, imgW, imgH);
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    document.body.removeChild(iframe);
  }
}

// ===== Build final PNGs (메모리 내) =====
async function buildFinalPngs(
  details: DesignDetail[],
  formats: SizedFormat[],
  fallbackOutline: OutlineFormat | null,
  testDesign: string | null,
  footer: FooterCfg,
  dpi: number,
  sharpen: boolean,
  onProgress?: (done: number, total: number) => void,
  transform?: { offsetXPct?: number; offsetYPct?: number; scale?: number },
  opts?: { embedDpiMetadata?: boolean; concurrency?: number; yieldEvery?: number; onItem?: (index: number, item: { designUid: string; blob: Blob | null; reason?: string }) => void },
): Promise<Array<{ designUid: string; blob: Blob | null; reason?: string }>> {
  const embedDpi = opts?.embedDpiMetadata ?? true;
  const concurrency = Math.max(1, opts?.concurrency ?? 4);
  const yieldEvery = Math.max(1, opts?.yieldEvery ?? concurrency);
  const total = details.length;
  const results: Array<{ designUid: string; blob: Blob | null; reason?: string } | undefined> =
    new Array(total).fill(undefined);

  // Cache alpha masks per format (keyed by mask canvas identity + dpi)
  const maskCache = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  const getMask = (fmt: { maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number }) => {
    const cached = maskCache.get(fmt.maskCanvas);
    if (cached) return cached;
    const tW = Math.max(64, Math.round((fmt.widthPt / 72) * dpi));
    const tH = Math.max(64, Math.round((fmt.heightPt / 72) * dpi));
    const m = buildAlphaMaskCanvas(fmt.maskCanvas, tW, tH);
    maskCache.set(fmt.maskCanvas, m);
    return m;
  };

  // Cache decoded design images per src string
  const imgCache = new Map<string, Promise<HTMLImageElement>>();
  const getImg = (src: string) => {
    let p = imgCache.get(src);
    if (!p) { p = loadImage(src); imgCache.set(src, p); }
    return p;
  };

  // Cache the expensive clipped-design base per source + format + transform.
  // Many 발주 rows reuse the same design/size; only the footer QR/UID differs.
  const srcIds = new Map<string, number>();
  let nextSrcId = 0;
  const getSrcId = (src: string) => {
    let id = srcIds.get(src);
    if (!id) { id = ++nextSrcId; srcIds.set(src, id); }
    return id;
  };
  const maskIds = new WeakMap<HTMLCanvasElement, number>();
  let nextMaskId = 0;
  const getMaskId = (maskCanvas: HTMLCanvasElement) => {
    let id = maskIds.get(maskCanvas);
    if (!id) { id = ++nextMaskId; maskIds.set(maskCanvas, id); }
    return id;
  };
  const baseCanvasCache = new Map<string, Promise<HTMLCanvasElement>>();
  const getBaseCanvas = (
    src: string,
    fmt: { maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number },
    preBuiltMask: HTMLCanvasElement,
    preLoadedImage: HTMLImageElement,
  ) => {
    const key = [
      getSrcId(src), getMaskId(fmt.maskCanvas), fmt.widthPt, fmt.heightPt, dpi,
      sharpen ? 1 : 0, transform?.offsetXPct ?? 0, transform?.offsetYPct ?? 0, transform?.scale ?? 1,
    ].join("|");
    let p = baseCanvasCache.get(key);
    if (!p) {
      p = composeClippedDesign(src, fmt.maskCanvas, fmt.widthPt, fmt.heightPt, dpi, transform,
        { sharpen, preBuiltMask, preLoadedImage });
      baseCanvasCache.set(key, p);
    }
    return p;
  };

  let done = 0;
  const processOne = async (idx: number) => {
    const d = details[idx];
    let item: { designUid: string; blob: Blob | null; reason?: string };
    try {
      const src = testDesign || d.designSrc;
      if (!src) {
        item = { designUid: d.designUid, blob: null, reason: "디자인 소스 없음" };
      } else {
        const target = normalizeSize(d.tshirtSize);
        const fmt = (target ? formats.find((f) => normalizeSize(f.sizeLabel) === target) : null) || fallbackOutline;
        if (!fmt) {
          item = { designUid: d.designUid, blob: null, reason: `사이즈 ${d.tshirtSize || "?"} 포맷 없음` };
        } else {
          const preMask = getMask(fmt);
          const preImg = await getImg(src);
          const c0 = await getBaseCanvas(src, fmt, preMask, preImg);
          const c = await composeWithFooter(c0, fmt.widthPt, dpi, d.designUid, footer, {
            tshirtType: d.tshirtType, tshirtColor: d.tshirtColor, tshirtSize: d.tshirtSize,
          });
          const rawBlob = await canvasToBlob(c);
          const blob = embedDpi ? await pngWithDpi(rawBlob, dpi) : rawBlob;
          item = { designUid: d.designUid, blob };
        }
      }
    } catch (e) {
      item = { designUid: d.designUid, blob: null, reason: String((e as Error)?.message || e) };
    }
    results[idx] = item;
    done++;
    onProgress?.(done, total);
    opts?.onItem?.(idx, item);
    if (done % yieldEvery === 0) await yieldToBrowser();
  };

  // Concurrency-limited pool
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      await processOne(i);
    }
  });
  await Promise.all(workers);
  return results as Array<{ designUid: string; blob: Blob | null; reason?: string }>;
}


// ===== OrderProgressBox: 작업지시서 / 작업파일 확인 / 발주 =====
function OrderProgressBox({
  order, details, outline, formats, testDesign,
}: {
  order: OrderRow;
  details: DesignDetail[];
  outline: OutlineFormat | null;
  formats: SizedFormat[];
  testDesign: string | null;
}) {
  const stateKey = `heatTransfer.progress.v1.${order.orderNo}`;
  const [confirmed1, setConfirmed1] = useState(false);
  const [confirmed2, setConfirmed2] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [open1, setOpen1] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string>(() => readHtWebhook());
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);
  const [serverProgress, setServerProgress] = useState<{ label: string; done: number; total: number; unit: string } | null>(null);
  const [sendStage, setSendStage] = useState<string>("");
  const [uploadIssues, setUploadIssues] = useState<UploadIssue[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [bundleDownloadUrl, setBundleDownloadUrl] = useState<string | null>(null);
  const sendStartedAtRef = useRef<number | null>(null);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!sending) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [sending]);

  // 실시간 발주 로그 (PNG 업로드 → ZIP 생성 → Storage 업로드 → 위챗 전송)
  type SendLog = { ts: number; level: "info" | "warn" | "error" | "success"; msg: string };
  const [sendLogs, setSendLogs] = useState<SendLog[]>([]);
  const lastLoggedStageRef = useRef<string>("");
  const appendSendLog = (level: SendLog["level"], msg: string) => {
    if (!msg) return;
    setSendLogs((arr) => [...arr, { ts: Date.now(), level, msg }].slice(-300));
  };
  // sendStage가 바뀔 때마다 자동으로 로그에 누적 (서버 callback에서 오는 stage 포함)
  useEffect(() => {
    if (sendStage && sendStage !== lastLoggedStageRef.current) {
      lastLoggedStageRef.current = sendStage;
      appendSendLog("info", sendStage);
    }
  }, [sendStage]);
  const sendLogsScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sendLogsScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sendLogs]);


  const readSavedTransform = () => {
    const d = readHtDesignUiDraft(order.orderNo);
    return { offsetXPct: d.offsetX ?? 0, offsetYPct: d.offsetY ?? 0, scale: d.designScale ?? 1 };
  };
  const [savedTransform, setSavedTransform] = useState(readSavedTransform);

  useEffect(() => {
    const refresh = () => { setWebhookUrl(readHtWebhook()); setSavedTransform(readSavedTransform()); };
    const onSaved = (e: Event) => {
      const ce = e as CustomEvent<{ orderNo?: string }>;
      if (!ce.detail?.orderNo || ce.detail.orderNo === order.orderNo) setSavedTransform(readSavedTransform());
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("htf:transformSaved", onSaved as EventListener);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("htf:transformSaved", onSaved as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.orderNo]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(stateKey);
      if (raw) {
        const s = JSON.parse(raw);
        setConfirmed1(!!s.confirmed1); setConfirmed2(!!s.confirmed2); setOrdered(!!s.ordered);
      } else { setConfirmed1(false); setConfirmed2(false); setOrdered(false); }
    } catch {}
  }, [stateKey]);

  const persist = (next: { confirmed1?: boolean; confirmed2?: boolean; ordered?: boolean }) => {
    const merged = { confirmed1, confirmed2, ordered, ...next };
    try { localStorage.setItem(stateKey, JSON.stringify(merged)); } catch {}
  };

  // Legacy png_jobs / heat-order-finalize resume flow removed.
  // The new orders-create + Render-worker pipeline tracks status via order_jobs realtime.



  // 저장된 footer 설정 로드
  const readFooter = (): FooterCfg => {
    try {
      const raw = localStorage.getItem("htf:footerCfg:v1");
      if (raw) return { ...DEFAULT_FOOTER_CFG, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_FOOTER_CFG;
  };

  // 작업지시서 하단에 첫번째 작업결과물 이미지 적용
  const [firstResultUrl, setFirstResultUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        if (!details || details.length === 0) { setFirstResultUrl(null); return; }
        const res = await buildFinalPngs(details.slice(0, 1), formats, outline, testDesign, readFooter(), 96, false, undefined, savedTransform);
        const first = res.find((r) => r.blob);
        if (cancelled) return;
        if (first && first.blob) {
          const reader = new FileReader();
          reader.onload = () => { if (!cancelled) setFirstResultUrl(String(reader.result || "")); };
          reader.readAsDataURL(first.blob);
        } else {
          setFirstResultUrl(null);
        }
      } catch { if (!cancelled) setFirstResultUrl(null); }
    })();
    return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.orderNo, details.length, outline?.previewUrl, testDesign, savedTransform]);

  // 작업지시서 HTML (저장된 값 + 폴백) — 하단에 첫 작업결과물 PNG 적용
  const woHtml = useMemo(() => {
    const wo = computeHtWorkOrderData(order);
    return buildHtWorkOrderHtml(wo, firstResultUrl || outline?.previewUrl, { autoPrint: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.orderNo, outline?.previewUrl, firstResultUrl, open1]);


  // Step 2: PNG 썸네일 미리보기 (스트리밍 + 캐시 + 동시 처리)
  const [thumbs, setThumbs] = useState<Array<{ designUid: string; url: string | null; reason?: string }>>([]);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbProgress, setThumbProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!open2) return;
    let cancelled = false;
    const createdUrls: string[] = [];
    (async () => {
      setThumbBusy(true);
      setThumbProgress({ done: 0, total: details.length });
      // 자리표시자: 완료되는 대로 채워 넣기
      setThumbs(details.map((d) => ({ designUid: d.designUid, url: null, reason: undefined })));
      try {
        // 미리보기는 72dpi + DPI 메타데이터 생략 + 4개 동시 처리 + 마스크/이미지 캐시
        await buildFinalPngs(
          details, formats, outline, testDesign, readFooter(), 72, false,
          (done, total) => { if (!cancelled) setThumbProgress({ done, total }); },
          savedTransform,
          {
            embedDpiMetadata: false,
            concurrency: 4,
            onItem: (idx, item) => {
              if (cancelled) return;
              const url = item.blob ? URL.createObjectURL(item.blob) : null;
              if (url) createdUrls.push(url);
              setThumbs((prev) => {
                const next = prev.slice();
                next[idx] = { designUid: item.designUid, url, reason: item.reason };
                return next;
              });
            },
          },
        );
      } finally {
        if (!cancelled) setThumbBusy(false);
      }
    })();
    return () => { cancelled = true; createdUrls.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open2, savedTransform]);

  // blob URL 정리는 위 effect의 cleanup(createdUrls)에서 처리합니다. 여기서 thumbs 변경마다 revoke 하면 streaming 중인 이미지가 모두 깨집니다.


  const sendOrder = async () => {
    const currentWebhookUrl = readHtWebhook() || webhookUrl.trim();
    if (!currentWebhookUrl) {
      toast({ title: "위챗 Webhook 미설정", description: "발주 전 위챗 Webhook을 먼저 설정하세요.", variant: "destructive" as any });
      setSettingsOpen(true);
      return;
    }
    if (currentWebhookUrl !== webhookUrl) setWebhookUrl(currentWebhookUrl);

    if (uploadManager.isRunning()) {
      console.log("[Upload] sendOrder already running, ignoring duplicate call");
      return;
    }

    setSending(true);
    sendingRef.current = true;
    sendStartedAtRef.current = Date.now();
    setSendProgress({ done: 0, total: details.length });
    setServerProgress(null);
    setSendStage("작업파일 준비 중");
    setUploadIssues([]);
    setSendLogs([]);
    lastLoggedStageRef.current = "";
    appendSendLog("info", `발주 시작 · 항목 ${details.length}건`);

    const folderName = order.orderNo || "heat-transfer";
    const stamp = Date.now();
    const tmpPrefix = `orders/heat-${folderName}-${stamp}`;
    const woPath = `${tmpPrefix}/__work_order.pdf`;

    try {
      await uploadManager.start(`${folderName}-${stamp}`, async () => {
        // 1) Work order PDF — uploaded to Storage (worker may include in legacy mode; in stream mode the PDF is embedded directly in the ZIP).
        setSendStage("작업지시서 업로드 중");
        const woBytes = await renderHtmlToPdfBytes(woHtml);
        const pdfBlob = new Blob([woBytes as BlobPart], { type: "application/pdf" });
        {
          const { error } = await supabase.storage.from("hologram-pdf")
            .upload(woPath, pdfBlob, { contentType: "application/pdf", upsert: true });
          if (error) throw new Error(`작업지시서 업로드 실패: ${error.message}`);
        }

        // 2) Register stream-mode job → returns signed upload URL for bundle.zip.
        setSendStage("발주 잡 등록 중");
        const totalExpected = details.length;
        const { data: createRes, error: createErr } = await supabase.functions.invoke("orders-create", {
          body: {
            orderNo: folderName,
            factory: "heat",
            webhookUrl: currentWebhookUrl,
            stream: true,
            itemCount: totalExpected,
            payload: {
              product_code: order.raw?.product_code || folderName,
              work_order_pdf_path: woPath,
              uploaded_count: totalExpected,
              client_stream: true,
            },
          },
        });
        if (createErr) throw new Error(`발주 잡 등록 실패: ${createErr.message}`);
        const jobId = (createRes as any)?.jobId as string | undefined;
        const bundle = (createRes as any)?.bundle as {
          upload_url: string;
          parts_url?: string;
          finalize_url?: string;
          abort_url?: string;
          path: string;
          upload_token: string;
        } | undefined;
        if (!jobId || !bundle?.parts_url || !bundle?.finalize_url) {
          throw new Error("발주 잡 응답에 업로드 URL 없음 (워커 재배포 필요)");
        }
        setActiveJobId(jobId);

        // 3) Build PNGs in parallel, upload each one individually to the Render worker.
        //    Worker accumulates files in a per-job temp dir; ZIP is built server-side on /finalize.
        setSendStage("PNG 생성 및 개별 업로드 중");
        const DPI = 300;
        const maskBlobCache = new Map<string, { blob: Blob; targetW: number; targetH: number; widthPt: number }>();
        const getMaskBundle = async (fmt: typeof formats[number] | typeof outline) => {
          if (!fmt) return null;
          const key = `${fmt.widthPt}x${fmt.heightPt}@${DPI}`;
          let b = maskBlobCache.get(key);
          if (!b) {
            const tW = Math.max(64, Math.round((fmt.widthPt / 72) * DPI));
            const tH = Math.max(64, Math.round((fmt.heightPt / 72) * DPI));
            const m = buildAlphaMaskCanvas(fmt.maskCanvas, tW, tH);
            const blob = await canvasToBlob(m);
            b = { blob, targetW: tW, targetH: tH, widthPt: fmt.widthPt };
            maskBlobCache.set(key, b);
          }
          return { key, ...b };
        };

        const cpuCount = Math.max(2, navigator.hardwareConcurrency || 4);
        const workerCount = Math.min(6, Math.max(2, Math.floor(cpuCount / 2)));
        const pool = new HtPngPool(workerCount);
        const footerCfg = readFooter();

        const used = new Map<string, number>();
        let okCount = 0, skipCount = 0, uploadedCount = 0;

        const addUploadIssue = (index: number, fileName: string, reason: string) => {
          setUploadIssues((prev) => [...prev, { index, fileName, reason }]);
          console.warn("[sendOrder] skip", `index=${index}`, fileName, reason);
        };

        // Per-PNG upload with retry. Each call is a small, bounded PUT —
        // no streaming-fetch / duplex tricks needed.
        const PART_UPLOAD_RETRIES = 3;
        const PART_UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;
        const uploadOnePart = async (name: string, body: Blob): Promise<void> => {
          const url = `${bundle.parts_url}&name=${encodeURIComponent(name)}`;
          let lastErr: unknown;
          for (let attempt = 1; attempt <= PART_UPLOAD_RETRIES; attempt++) {
            const ac = new AbortController();
            const t = window.setTimeout(() => ac.abort(), PART_UPLOAD_TIMEOUT_MS);
            try {
              const r = await fetch(url, {
                method: "PUT",
                headers: { "Content-Type": "image/png" },
                body,
                signal: ac.signal,
              });
              window.clearTimeout(t);
              if (!r.ok) {
                const txt = await r.text().catch(() => "");
                throw new Error(`part ${r.status}: ${txt.slice(0, 200)}`);
              }
              return;
            } catch (e) {
              window.clearTimeout(t);
              lastErr = e;
              if (attempt < PART_UPLOAD_RETRIES) await new Promise((r) => setTimeout(r, 500 * attempt));
            }
          }
          throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
        };

        // Bounded-concurrency upload queue fed by PNG producers.
        const UPLOAD_CONCURRENCY = HT_UPLOAD_CONCURRENCY;
        const uploadQueue: Array<{ name: string; blob: Blob }> = [];
        const uploadWaiters: Array<() => void> = [];
        let producersDone = false;
        let uploadAborted = false;
        const enqueueUpload = (item: { name: string; blob: Blob }) => {
          uploadQueue.push(item);
          uploadWaiters.shift()?.();
        };
        const signalProducersDone = () => {
          producersDone = true;
          while (uploadWaiters.length) uploadWaiters.shift()!();
        };
        const uploadWorker = async (): Promise<void> => {
          while (!uploadAborted) {
            const item = uploadQueue.shift();
            if (!item) {
              if (producersDone) return;
              await new Promise<void>((res) => uploadWaiters.push(res));
              continue;
            }
            await uploadOnePart(item.name, item.blob);
            uploadedCount++;
            setSendProgress({ done: uploadedCount, total: totalExpected });
            setSendStage(`PNG ${uploadedCount}/${totalExpected} 업로드 중`);
          }
        };
        const uploaders: Promise<void>[] = [];
        for (let k = 0; k < UPLOAD_CONCURRENCY; k++) {
          uploaders.push(uploadWorker().catch((e) => { uploadAborted = true; throw e; }));
        }
        const allUploadsDone = Promise.all(uploaders);

        try {
          let cursor = 0;
          const runOne = async (): Promise<void> => {
            while (!uploadAborted) {
              const i = cursor++;
              if (i >= details.length) return;
              const d = details[i];
              const src = testDesign || d.designSrc;
              if (!src) { skipCount++; addUploadIssue(i + 1, `${d.designUid}.png`, "디자인 소스 없음"); continue; }
              const target = normalizeSize(d.tshirtSize);
              const fmt = (target ? formats.find((f) => normalizeSize(f.sizeLabel) === target) : null) || outline;
              if (!fmt) { skipCount++; addUploadIssue(i + 1, `${d.designUid}.png`, `사이즈 ${d.tshirtSize || "?"} 포맷 없음`); continue; }
              const mb = await getMaskBundle(fmt);
              if (!mb) { skipCount++; addUploadIssue(i + 1, `${d.designUid}.png`, "마스크 생성 실패"); continue; }

              const task: PoolTask = {
                idx: i,
                designUid: d.designUid,
                designSrc: src,
                maskKey: mb.key,
                maskBlob: mb.blob,
                targetW: mb.targetW,
                targetH: mb.targetH,
                widthPt: mb.widthPt,
                dpi: DPI,
                transform: {
                  offsetXPct: savedTransform?.offsetXPct ?? 0,
                  offsetYPct: savedTransform?.offsetYPct ?? 0,
                  scale: savedTransform?.scale ?? 1,
                },
                footer: footerCfg,
                meta: { tshirtType: d.tshirtType, tshirtColor: d.tshirtColor, tshirtSize: d.tshirtSize },
              };

              let blob: Blob | null = null;
              try {
                const res = await pool.enqueue(task);
                if (res.blob) {
                  blob = res.blob;
                } else {
                  // Main-thread fallback
                  const c0 = await composeClippedDesign(src, fmt.maskCanvas, fmt.widthPt, fmt.heightPt, DPI, task.transform);
                  const c = await composeWithFooter(c0, fmt.widthPt, DPI, d.designUid, footerCfg, task.meta);
                  blob = await pngWithDpi(await canvasToBlob(c), DPI);
                }
              } catch (e) {
                skipCount++;
                addUploadIssue(i + 1, `${d.designUid}.png`, e instanceof Error ? e.message : String(e));
                continue;
              }

              const padN = Math.max(2, String(details.length).length);
              const seq = String(i + 1).padStart(padN, "0");
              const sanitize = (s: string) => (s || "").replace(/[\\/:*?"<>|\r\n\t]+/g, "_").replace(/\s+/g, " ").trim();
              const designName = sanitize(d.designUid) || `item${i + 1}`;
              const baseFile = `${seq}_${designName}.png`;
              const count = used.get(baseFile) ?? 0;
              const name = count === 0 ? baseFile : baseFile.replace(/\.png$/, `(${count}).png`);
              used.set(baseFile, count + 1);
              okCount++;
              enqueueUpload({ name, blob });
            }
          };

          const runners: Promise<void>[] = [];
          for (let k = 0; k < workerCount; k++) runners.push(runOne());
          await Promise.all(runners);
          signalProducersDone();
          console.log("[sendOrder] all PNGs queued — ok:", okCount, "skip:", skipCount);
          await allUploadsDone;
        } catch (e) {
          uploadAborted = true;
          signalProducersDone();
          pool.terminate();
          if (bundle.abort_url) {
            fetch(bundle.abort_url, { method: "DELETE" }).catch(() => undefined);
          }
          throw e;
        }

        if (okCount === 0) {
          pool.terminate();
          if (bundle.abort_url) {
            fetch(bundle.abort_url, { method: "DELETE" }).catch(() => undefined);
          }
          throw new Error(`생성된 PNG가 0건입니다 (skip=${skipCount}). 작업파일을 다시 확인하세요.`);
        }
        pool.terminate();

        // 4) Trigger finalize — worker builds the ZIP, uploads to Storage, then ships to WeChat.
        appendSendLog("info", `PNG 업로드 완료 · ${uploadedCount}건 (skip ${skipCount}건)`);
        setServerProgress(null);
        setSendStage(`Render 마무리 중 (PNG ${uploadedCount}건 → ZIP 생성/Storage/위챗)`);
        appendSendLog("info", "Render 워커에 마무리(finalize) 요청 전송");
        const finalizeRes = await fetch(bundle.finalize_url, { method: "POST" });
        const finalizeTxt = await finalizeRes.text();
        if (!finalizeRes.ok) {
          appendSendLog("error", `마무리 요청 실패: ${finalizeRes.status} ${finalizeTxt.slice(0, 200)}`);
          throw new Error(`마무리 실패 ${finalizeRes.status}: ${finalizeTxt.slice(0, 300)}`);
        }
        appendSendLog("info", "워커가 마무리 요청 접수 (백그라운드 처리 시작)");


        // 5) Wait for worker → done / failed via realtime + polling fallback.
        setSendStage("위챗 전송 대기");
        await new Promise<void>((resolve, reject) => {
          const maxWaitMs = 15 * 60 * 1000;
          const startedAt = Date.now();
          let settled = false;
          const handleRow = (row: any) => {
            if (!row || settled) return;
            if (row.stage) {
              const stage = String(row.stage);
              setSendStage(stage);
              const current = Number(row.progress_current ?? 0);
              const totalValue = Number(row.progress_total ?? 0);
              if (totalValue > 0 && Number.isFinite(current) && Number.isFinite(totalValue)) {
                if (/Storage 업로드/.test(stage)) {
                  setServerProgress({ label: "Storage 업로드", done: current, total: totalValue, unit: "MB" });
                } else if (/ZIP 생성/.test(stage)) {
                  setServerProgress({ label: "ZIP 생성", done: current, total: totalValue, unit: "개" });
                }
              }
            }
            if (row.status === "done") {
              settled = true;
              supabase.removeChannel(ch); clearInterval(pollT);
              setOrdered(true); persist({ ordered: true });
              const dl = typeof row.bundle_zip_url === "string" ? row.bundle_zip_url : null;
              if (dl) {
                setBundleDownloadUrl(dl);
                appendSendLog("success", `발주 완료 · 다운로드 링크 준비됨`);
                appendSendLog("info", `다운로드 URL: ${dl}`);
                try { window.open(dl, "_blank", "noopener"); } catch { /* popup blocked */ }
              } else {
                appendSendLog("success", "발주 완료 · 위챗 단톡방으로 다운로드 링크 전송됨");
              }
              toast({ title: "발주 완료", description: dl ? `${folderName} ZIP 다운로드 링크가 준비되었습니다 (위챗 단톡방에도 전송됨)` : `${folderName} 다운로드 링크가 위챗 단톡방으로 전송됨` });
              resolve();
            } else if (row.status === "failed") {
              settled = true;
              supabase.removeChannel(ch); clearInterval(pollT);
              appendSendLog("error", `서버 처리 실패: ${row.error_message || "(원인 미상)"}`);
              reject(new Error(row.error_message || "서버에서 발주 마무리 실패"));
            }
          };
          const ch = supabase.channel(`order-jobs-${jobId}`)
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "order_jobs", filter: `id=eq.${jobId}` },
              (payload) => handleRow(payload.new))
            .subscribe();
          const pollT = setInterval(async () => {
            if (settled) return;
            if (Date.now() - startedAt > maxWaitMs) {
              settled = true; supabase.removeChannel(ch); clearInterval(pollT);
              appendSendLog("error", "서버 처리 타임아웃 (15분 초과)");
              reject(new Error("서버 처리 타임아웃 (15분 초과)"));
              return;
            }
            const { data } = await supabase.from("order_jobs")
              .select("status, stage, progress_current, progress_total, bundle_zip_url, error_message").eq("id", jobId).maybeSingle();
            if (data) handleRow(data);
          }, 5000);
        });
      });
    } catch (e: any) {
      appendSendLog("error", `발주 실패: ${e?.message || String(e)}`);
      toast({ title: "발주 실패", description: e?.message || String(e), variant: "destructive" as any });
    } finally {
      setSending(false);
      sendingRef.current = false;
      setSendProgress(null);
      setServerProgress(null);
      setSendStage("");
      sendStartedAtRef.current = null;
    }
  };




  const Step = ({ idx, label, done, disabled, onClick }: { idx: number; label: string; done: boolean; disabled: boolean; onClick: () => void }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex-1 rounded-lg border p-4 text-left transition-colors ${
        done ? "border-primary bg-primary/5" : disabled ? "border-border bg-muted/30 opacity-60 cursor-not-allowed" : "border-border hover:bg-accent"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}>
          {done ? <CheckCircle2 className="w-4 h-4" /> : idx}
        </div>
        <div className="font-medium text-sm">{label}</div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {done ? "완료" : disabled ? "이전 단계를 먼저 완료하세요" : "클릭하여 진행"}
      </div>
    </button>
  );

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="w-4 h-4" /> 발주 진행
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
          <Settings className="w-4 h-4 mr-1" /> 위챗 Webhook
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row gap-3">
          <Step idx={1} label="작업지시서" done={confirmed1} disabled={false} onClick={() => setOpen1(true)} />
          <Step idx={2} label="작업파일 확인" done={confirmed2} disabled={!confirmed1} onClick={() => setOpen2(true)} />
          <Step idx={3} label="발주" done={ordered} disabled={!confirmed1 || !confirmed2 || sending} onClick={sendOrder} />
        </div>

        {/* Step 1 — 작업지시서 A4 미리보기 */}
        <Dialog open={open1} onOpenChange={setOpen1}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader><DialogTitle>작업지시서 미리보기 (A4)</DialogTitle></DialogHeader>
            <div className="flex-1 overflow-auto border rounded-md bg-white">
              <iframe title="ht-work-order-preview" srcDoc={woHtml} className="w-full h-[70vh] bg-white" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen1(false)}>닫기</Button>
              <Button onClick={() => { setConfirmed1(true); persist({ confirmed1: true }); setOpen1(false); toast({ title: "작업지시서 확인 완료" }); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Step 2 — 작업파일 확인 (PNG 썸네일 갤러리) */}
        <Dialog open={open2} onOpenChange={setOpen2}>
          <DialogContent className="max-w-[95vw] w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-green-600" />
                작업파일 확인 — 최종 출력 PNG 미리보기 ({details.length}건)
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto border rounded-md bg-muted/20 p-3">
              {thumbBusy && thumbProgress && (
                <div className="flex items-center justify-center pb-3 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  PNG 생성 중... {thumbProgress.done} / {thumbProgress.total}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {thumbs.map((t, i) => (
                  <div key={`${t.designUid}-${i}`} className="rounded border bg-white overflow-hidden flex flex-col">
                    <div className="w-full aspect-square bg-[conic-gradient(at_50%_50%,#eee_25%,#fff_0_50%,#eee_0_75%,#fff_0)] bg-[length:12px_12px] flex items-center justify-center overflow-hidden">
                      {t.url ? (
                        <img src={t.url} alt={t.designUid} className="max-w-full max-h-full object-contain" loading="lazy" />
                      ) : t.reason ? (
                        <div className="text-[10px] text-destructive text-center px-1">{t.reason}</div>
                      ) : (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="px-2 py-1 text-[11px] font-mono truncate border-t" title={t.designUid}>{t.designUid}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setOpen2(false)}>닫기</Button>
              <Button onClick={() => { setConfirmed2(true); persist({ confirmed2: true }); setOpen2(false); toast({ title: "작업파일 확인 완료" }); }} disabled={thumbBusy}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Webhook 설정 */}
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>열전사 디자인 공장 위챗 Webhook</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs">기업위챗 그룹봇 Webhook URL</Label>
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
              <p className="text-xs text-muted-foreground">발주 시 이 그룹채팅으로 ZIP 다운로드 링크가 전송됩니다.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>취소</Button>
              <Button onClick={() => { writeHtWebhook(webhookUrl); toast({ title: "위챗 Webhook 저장됨" }); setSettingsOpen(false); }}>
                <Send className="w-4 h-4 mr-1" /> 저장
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {sending && (() => {
          const done = sendProgress?.done ?? 0;
          const total = sendProgress?.total ?? 0;
          // PNG 업로드(0~90%) + 서버 ZIP/마무리(90~100%) 가중치 적용
          const pngPct = total > 0 ? (done / total) * 90 : 0;
          const stageHints = sendStage || "";
          const serverPct = serverProgress && serverProgress.total > 0
            ? Math.min(100, Math.max(0, (serverProgress.done / serverProgress.total) * 100))
            : null;
          const inZipStage = /ZIP|Storage|위챗|발주 이력|마무리|finaliz/i.test(stageHints);
          const tailPct = serverPct !== null ? (serverPct / 100) * 9 : (inZipStage ? 8 : 0);
          const percent = Math.min(99, Math.round(pngPct + tailPct));
          const startedAt = sendStartedAtRef.current;
          const elapsedMs = startedAt ? Date.now() - startedAt : 0;
          let etaText = "";
          if (startedAt && done > 0 && total > 0 && done < total) {
            const rate = done / (elapsedMs / 1000); // items/sec
            const remaining = (total - done) / Math.max(rate, 0.0001);
            const m = Math.floor(remaining / 60);
            const s = Math.round(remaining % 60);
            etaText = m > 0 ? `약 ${m}분 ${s}초 남음` : `약 ${s}초 남음`;
          } else if (serverProgress) {
            etaText = `${serverProgress.label} ${serverProgress.done}/${serverProgress.total}${serverProgress.unit}`;
          } else if (startedAt && done >= total && total > 0) {
            etaText = "마무리 중…";
          } else if (startedAt) {
            etaText = "예상 시간 계산 중…";
          }
          const elapsedSec = Math.floor(elapsedMs / 1000);
          const em = Math.floor(elapsedSec / 60);
          const es = elapsedSec % 60;
          const elapsedText = em > 0 ? `${em}분 ${es}초 경과` : `${es}초 경과`;
          return (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center text-muted-foreground">
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  {sendStage || "발주 전송 중"}
                  {total > 0 ? ` · PNG ${done}/${total}` : ""}
                </div>
                <div className="font-semibold tabular-nums">{percent}%</div>
              </div>
              <Progress value={percent} className="h-2" />
              {serverProgress && (
                <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span>{serverProgress.label} 진행률</span>
                    <span className="tabular-nums">
                      {serverProgress.done}/{serverProgress.total}{serverProgress.unit} · {Math.min(100, Math.round((serverProgress.done / Math.max(1, serverProgress.total)) * 100))}%
                    </span>
                  </div>
                  <Progress value={Math.min(100, (serverProgress.done / Math.max(1, serverProgress.total)) * 100)} className="mt-1 h-1.5" />
                </div>
              )}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>{elapsedText}</span>
                <span>{etaText}</span>
              </div>
              {sendLogs.length > 0 && (
                <div className="mt-2 rounded-md border bg-muted/40">
                  <div className="flex items-center justify-between px-2 py-1 border-b text-[11px] text-muted-foreground">
                    <span className="font-medium">실시간 진행 로그</span>
                    <span className="tabular-nums">{sendLogs.length}건</span>
                  </div>
                  <div
                    ref={sendLogsScrollRef}
                    className="max-h-44 overflow-auto px-2 py-1 font-mono text-[11px] leading-5"
                  >
                    {sendLogs.map((l, i) => {
                      const d = new Date(l.ts);
                      const hh = String(d.getHours()).padStart(2, "0");
                      const mm = String(d.getMinutes()).padStart(2, "0");
                      const ss = String(d.getSeconds()).padStart(2, "0");
                      const color =
                        l.level === "error" ? "text-destructive"
                        : l.level === "warn" ? "text-amber-600 dark:text-amber-400"
                        : l.level === "success" ? "text-emerald-600 dark:text-emerald-400"
                        : "text-foreground/80";
                      return (
                        <div key={i} className="flex gap-2">
                          <span className="text-muted-foreground tabular-nums">{hh}:{mm}:{ss}</span>
                          <span className={color}>{l.msg}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {uploadIssues.length > 0 && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <div className="font-medium text-destructive">업로드 실패 / skip 목록 ({uploadIssues.length}건)</div>
            <div className="mt-2 max-h-36 overflow-auto space-y-1 font-mono">
              {uploadIssues.map((issue, idx) => (
                <div key={`${issue.index}-${issue.fileName}-${idx}`} className="grid grid-cols-[52px_1fr_2fr] gap-2 text-muted-foreground">
                  <span>#{issue.index}</span>
                  <span className="truncate" title={issue.fileName}>{issue.fileName}</span>
                  <span className="text-destructive" title={issue.reason}>{issue.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {bundleDownloadUrl && (
          <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs">
            <div className="font-medium text-emerald-700 dark:text-emerald-400 mb-2">
              ✅ ZIP 다운로드 준비 완료 (스트리밍)
            </div>
            <div className="text-muted-foreground mb-2 leading-relaxed">
              아래 버튼을 누르면 서버가 PNG를 실시간으로 ZIP으로 묶어 즉시 전송합니다.
              브라우저 다운로드 표시줄에 나타날 때까지 잠시 기다려 주세요.
              위챗 단톡방에도 동일한 링크가 전송되었습니다.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => { try { window.open(bundleDownloadUrl, "_blank", "noopener"); } catch { /* noop */ } }}
              >
                <Send className="w-3.5 h-3.5 mr-1.5" /> ZIP 다운로드 시작
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(bundleDownloadUrl);
                    toast({ title: "다운로드 링크 복사됨" });
                  } catch { /* noop */ }
                }}
              >
                링크 복사
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBundleDownloadUrl(null)}
              >
                닫기
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WorkOrderInfoBox({ order, outlinePreview }: { order: OrderRow; outlinePreview?: string | null }) {
  const sd = order.raw?.source_data || {};
  const WO_LS_KEY = `heatTransfer.workOrder.v1.${order.orderNo}`;
  // 실리콘 마크 공장에서 저장한 작업지시서 값을 받을사람/전화/주소 기본값으로 사용
  const siliconDefaults = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const exact = localStorage.getItem(`silicon.workOrder.v1.${order.orderNo}`);
      if (exact) return JSON.parse(exact);
      // fallback: 가장 최근 저장된 실리콘 작업지시서
      let latest: any = null;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith("silicon.workOrder.v1.")) continue;
        const v = localStorage.getItem(k);
        if (v) { try { latest = JSON.parse(v); } catch { /* */ } }
      }
      return latest;
    } catch { return null; }
  }, [order.orderNo]);
  const defaults: HtWorkOrderData = useMemo(() => ({
    company: "TWINMETA",
    orderNo: order.orderNo,
    orderDate: order.receivedAt,
    deliveryDate: order.dueDate,
    total: order.workQty,
    recipient: siliconDefaults?.recipient || order.raw?.recipient_name || "TWINMETA",
    phone: siliconDefaults?.phone || order.raw?.recipient_phone || "18562757070",
    address: siliconDefaults?.address || order.raw?.shipping_address || "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
    notes: sd.notes || sd.special_notes || sd.memo || "",
  }), [order, siliconDefaults]);
  const [wo, setWo] = useState<HtWorkOrderData>(defaults);
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(WO_LS_KEY) : null;
      if (raw) setWo({ ...defaults, ...JSON.parse(raw) });
      else setWo(defaults);
    } catch { setWo(defaults); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.orderNo]);
  const set = (patch: Partial<HtWorkOrderData>) => setWo((p) => ({ ...p, ...patch }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>작업지시서 설정</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={() => {
              try { localStorage.setItem(WO_LS_KEY, JSON.stringify(wo)); toast({ title: "작업지시서 저장됨" }); }
              catch (e: any) { toast({ title: "저장 실패", description: e?.message, variant: "destructive" }); }
            }}>저장</Button>
            <Button size="sm" variant="outline" onClick={() => printHtWorkOrder(wo, outlinePreview)}>
              <FileText className="w-4 h-4 mr-1" />작업지시서 출력
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TxtField label="발주업체명" v={wo.company} set={(v) => set({ company: v })} />
        <TxtField label="작업번호" v={wo.orderNo} set={(v) => set({ orderNo: v })} />
        <div className="grid grid-cols-2 gap-2">
          <TxtField label="발주일" type="date" v={wo.orderDate} set={(v) => set({ orderDate: v })} />
          <TxtField label="납품일" type="date" v={wo.deliveryDate} set={(v) => set({ deliveryDate: v })} />
        </div>
        <TxtField label="총수량" type="number" v={String(wo.total)} set={(v) => set({ total: Number(v) || 0 })} />
        <TxtField label="받을사람" v={wo.recipient} set={(v) => set({ recipient: v })} />
        <TxtField label="전화번호" v={wo.phone} set={(v) => set({ phone: v })} />
        <div className="md:col-span-3">
          <TxtField label="주소" v={wo.address} set={(v) => set({ address: v })} />
        </div>
        <div className="md:col-span-3 space-y-1">
          <Label className="text-xs">발주특이사항</Label>
          <Textarea value={wo.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder="특이사항을 입력하세요" />
        </div>
      </CardContent>
    </Card>
  );
}

// ============ design tab ============

function DesignTab({
  order, details, outline, formats,
  testDesign, setTestDesign, testName, setTestName,
}: {
  order: OrderRow;
  details: DesignDetail[];
  outline: OutlineFormat | null;
  formats: SizedFormat[];
  testDesign: string | null;
  setTestDesign: (v: string | null) => void;
  testName: string;
  setTestName: (v: string) => void;
}) {


  const uiDraft = useMemo(() => readHtDesignUiDraft(order.orderNo), [order.orderNo]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quality, setQualityState] = useState<QualityPresetKey>(uiDraft.quality ?? "auto");
  const [autoResolved, setAutoResolved] = useState<{ preset: Exclude<QualityPresetKey, "auto">; reason: string } | null>(null);
  // DPI & "원본 해상도 유지" — persisted per-order
  const [dpiState, setDpiState] = useState<number>(uiDraft.dpi ?? 300);
  const [useOriginalRes, setUseOriginalResState] = useState<boolean>(uiDraft.useOriginalRes ?? true);
  const setDpi = (v: number) => {
    const clamped = Math.max(72, Math.min(1200, Math.round(v) || 300));
    setDpiState(clamped);
    writeHtDesignUiDraft(order.orderNo, { dpi: clamped });
  };
  const setUseOriginalRes = (v: boolean) => {
    setUseOriginalResState(v);
    writeHtDesignUiDraft(order.orderNo, { useOriginalRes: v });
  };
  // design transform within fixed format (offset in %, scale relative to cover-fit)
  const [offsetX, setOffsetXState] = useState(uiDraft.offsetX ?? 0);
  const [offsetY, setOffsetYState] = useState(uiDraft.offsetY ?? 0);
  const [designScale, setDesignScaleState] = useState(uiDraft.designScale ?? 1);
  const setQuality = (v: QualityPresetKey) => { setQualityState(v); writeHtDesignUiDraft(order.orderNo, { quality: v }); };
  const setOffsetX = (v: number) => setOffsetXState(v);
  const setOffsetY = (v: number) => setOffsetYState(v);
  const setDesignScale = (v: number) => setDesignScaleState(v);
  const transform = { offsetXPct: offsetX, offsetYPct: offsetY, scale: designScale };

  // Footer (UID + QR) config — persisted to localStorage
  const FOOTER_STORAGE_KEY = "htf:footerCfg:v1";
  const [footer, setFooter] = useState<FooterCfg>(() => {
    try {
      const raw = localStorage.getItem(FOOTER_STORAGE_KEY);
      if (raw) return { ...DEFAULT_FOOTER_CFG, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_FOOTER_CFG;
  });
  const [testUid, setTestUidState] = useState<string>(uiDraft.testUid ?? "");
  const setTestUid = (v: string) => { setTestUidState(v); writeHtDesignUiDraft(order.orderNo, { testUid: v }); };

  useEffect(() => {
    const next = readHtDesignUiDraft(order.orderNo);
    setQualityState(next.quality ?? "auto");
    setOffsetXState(next.offsetX ?? 0);
    setOffsetYState(next.offsetY ?? 0);
    setDesignScaleState(next.designScale ?? 1);
    setTestUidState(next.testUid ?? "");
    setDpiState(next.dpi ?? 300);
    setUseOriginalResState(next.useOriginalRes ?? true);
  }, [order.orderNo]);




  const first = details[0];
  const effectiveDesign = testDesign || first?.designSrc || null;

  // dpi/sharpen driven by explicit user setting (not quality preset).
  // Sharpen only when we'd upscale (>= 450 dpi) — useOriginal never sharpens.
  const dpi = dpiState;
  const sharpen = !useOriginalRes && dpi >= 450;

  const previewUid = (testUid.trim() || first?.designUid || "");


  // regenerate preview when inputs change (use 96dpi for screen preview)
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!outline || !effectiveDesign) { setPreviewUrl(null); return; }
      try {
        const canvas = await composeClippedDesign(effectiveDesign, outline.maskCanvas, outline.widthPt, outline.heightPt, 96, transform, { sharpen });
        const withFooter = await composeWithFooter(canvas, outline.widthPt, 96, previewUid, footer, {
          tshirtType: first?.tshirtType,
          tshirtColor: first?.tshirtColor,
          tshirtSize: first?.tshirtSize,
        });
        if (!cancelled) setPreviewUrl(withFooter.toDataURL("image/png"));
      } catch (e) { /* ignore */ }
    }
    run();
    return () => { cancelled = true; };
  }, [outline, effectiveDesign, offsetX, offsetY, designScale, sharpen, previewUid, footer.enabled, footer.qrSizeMm, footer.textSizeMm, footer.offsetXPct, footer.bottomPaddingMm, footer.gapMm]);


  const handleTestUpload = async (f: File) => {
    const url = await new Promise<string>((resolve) => {
      const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(f);
    });
    setTestDesign(url); setTestName(f.name);
    try {
      await saveHtPersistedDesign(order.orderNo, url, f.name);
      toast({ title: "작업 파일 저장됨", description: "다른 메뉴로 이동해도 이 작업번호에 유지됩니다." });
    } catch (e: any) {
      toast({ title: "작업 파일 저장 실패", description: e?.message || "브라우저 저장공간을 확인하세요.", variant: "destructive" });
    }
  };

  const [logs, setLogs] = useState<Array<{ ts: string; level: "info" | "warn" | "error"; msg: string }>>([]);
  const pushLog = (level: "info" | "warn" | "error", msg: string) =>
    setLogs((prev) => [{ ts: new Date().toLocaleTimeString(), level, msg }, ...prev].slice(0, 200));

  const resolveStrictFormat = (d: DesignDetail): OutlineFormat | null => {
    const target = normalizeSize(d.tshirtSize);
    if (!target) return null;
    return formats.find((f) => normalizeSize(f.sizeLabel) === target) || null;
  };

  const downloadOne = async (d: DesignDetail) => {
    const fmt = resolveStrictFormat(d) || outline;
    if (!fmt) {
      pushLog("error", `사이즈 "${d.tshirtSize || "?"}"에 해당하는 디자인 포맷이 없습니다 (${d.designUid})`);
      toast({ title: "디자인 포맷 없음", description: `사이즈 "${d.tshirtSize || "?"}" 포맷을 먼저 등록하세요`, variant: "destructive" });
      return;
    }
    const src = testDesign || d.designSrc;
    if (!src) { toast({ title: "디자인 소스가 없습니다", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const c0 = await composeClippedDesign(src, fmt.maskCanvas, fmt.widthPt, fmt.heightPt, dpi, transform, { sharpen, useOriginal: useOriginalRes });
      const c = await composeWithFooter(c0, fmt.widthPt, dpi, d.designUid, footer, {
        tshirtType: d.tshirtType, tshirtColor: d.tshirtColor, tshirtSize: d.tshirtSize,
      });
      const b = await pngWithDpi(await canvasToBlob(c), dpi);
      const tag = useOriginalRes ? "orig" : `${dpi}dpi`;
      triggerDownload(b, `${d.designUid}_${d.tshirtSize || "size"}_${tag}.png`);
    } finally { setBusy(false); }
  };

  const downloadAll = async () => {
    if (formats.length === 0) {
      pushLog("error", "등록된 디자인 포맷이 없습니다");
      toast({ title: "디자인 포맷 없음", description: "사이즈별 디자인 포맷을 먼저 등록하세요", variant: "destructive" });
      return;
    }
    setBusy(true);
    const startedAt = new Date().toLocaleTimeString();
    pushLog("info", `일괄 다운로드 시작 · ${details.length}개 · ${useOriginalRes ? "원본 해상도" : `${dpi}dpi`} · 병렬 워커`);

    // Plan all tasks first (skip invalid items up front).
    type Plan = { idx: number; d: typeof details[number]; fmt: NonNullable<ReturnType<typeof resolveStrictFormat>>; src: string };
    const plans: Plan[] = [];
    const preSkippedIdx: number[] = [];
    let skipped = 0;
    for (let i = 0; i < details.length; i++) {
      const d = details[i];
      const src = testDesign || d.designSrc;
      if (!src) { skipped++; preSkippedIdx.push(i); pushLog("warn", `건너뜀: ${d.designUid} — 디자인 소스 없음`); continue; }
      const fmt = resolveStrictFormat(d);
      if (!fmt) { skipped++; preSkippedIdx.push(i); pushLog("warn", `건너뜀: ${d.designUid} (사이즈 ${d.tshirtSize || "미지정"}) — 포맷 없음`); continue; }
      plans.push({ idx: i, d, fmt, src });
    }

    if (plans.length === 0) {
      setBusy(false);
      pushLog("error", "생성할 항목이 없습니다");
      toast({ title: "일괄 다운로드 실패", description: "사이즈에 맞는 포맷이 하나도 없습니다", variant: "destructive" });
      return;
    }

    // Build mask blob cache (once per size) and spin up a worker pool.
    const maskCache = new Map<string, { blob: Blob; targetW: number; targetH: number; widthPt: number }>();
    const getMask = async (fmt: Plan["fmt"]) => {
      const key = useOriginalRes
        ? `${fmt.widthPt}x${fmt.heightPt}@orig`
        : `${fmt.widthPt}x${fmt.heightPt}@${dpi}`;
      let b = maskCache.get(key);
      if (!b) {
        // useOriginal: build alpha mask at PDF-native size; worker scales per-image.
        const tW = useOriginalRes
          ? fmt.maskCanvas.width
          : Math.max(64, Math.round((fmt.widthPt / 72) * dpi));
        const tH = useOriginalRes
          ? fmt.maskCanvas.height
          : Math.max(64, Math.round((fmt.heightPt / 72) * dpi));
        const m = buildAlphaMaskCanvas(fmt.maskCanvas, tW, tH);
        b = { blob: await canvasToBlob(m), targetW: tW, targetH: tH, widthPt: fmt.widthPt };
        maskCache.set(key, b);
      }
      return b;
    };

    const cpuCount = Math.max(2, navigator.hardwareConcurrency || 4);
    const workerCount = Math.min(6, Math.max(2, Math.floor(cpuCount / 2)));
    const pool = new HtPngPool(workerCount);
    pushLog("info", `워커 ${workerCount}개 가동`);

    // Streaming ZIP queue: workers push finished PNGs here; downloadZip pulls.
    type ZipItem = { name: string; lastModified: Date; input: Blob };
    const zipQueue: ZipItem[] = [];
    const waiters: Array<(v: ZipItem | null) => void> = [];
    let producersDone = false;
    const pushItem = (it: ZipItem) => {
      const w = waiters.shift();
      if (w) w(it); else zipQueue.push(it);
    };
    const finishProducers = () => {
      producersDone = true;
      while (waiters.length) waiters.shift()!(null);
    };
    async function* zipSource(): AsyncGenerator<ZipItem> {
      while (true) {
        if (zipQueue.length) { yield zipQueue.shift()!; continue; }
        if (producersDone) return;
        const next = await new Promise<ZipItem | null>((res) => waiters.push(res));
        if (!next) return;
        yield next;
      }
    }

    const baseName = order.orderNo || "order";
    const padN = Math.max(2, String(details.length).length);
    const sanitizeName = (s: string) => (s || "").replace(/[\\/:*?"<>|\r\n\t]+/g, "_").replace(/\s+/g, " ").trim();

    // Ordered emission: buffer items by idx so ZIP entries appear in row order
    // regardless of which worker finishes first.
    const pendingByIdx = new Map<number, ZipItem | null>();
    let nextIdx = 0;
    const markIdx = (idx: number, item: ZipItem | null) => {
      pendingByIdx.set(idx, item);
      while (pendingByIdx.has(nextIdx)) {
        const it = pendingByIdx.get(nextIdx)!;
        pendingByIdx.delete(nextIdx);
        nextIdx++;
        if (it) pushItem(it);
      }
    };
    let matched = 0;
    let done = 0;

    // 작업지시서.pdf — 미리보기와 동일하게 '첫 작업결과물(합성된 디자인)' 이미지 포함.
    try {
      let firstUrl: string | undefined;
      try {
        const res = await buildFinalPngs(details.slice(0, 1), formats, outline, testDesign, footer, 96, false, undefined, transform);
        const first = res.find((r) => r.blob);
        if (first?.blob) {
          firstUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(first.blob!);
          });
        }
      } catch (e) {
        pushLog("warn", `첫 작업결과물 합성 실패, 외곽선으로 대체: ${e instanceof Error ? e.message : String(e)}`);
      }
      const wo = computeHtWorkOrderData(order);
      const woHtml = buildHtWorkOrderHtml(wo, firstUrl || outline?.previewUrl, { autoPrint: false });
      const woBytes = await renderHtmlToPdfBytes(woHtml);
      const pdfBlob = new Blob([woBytes as BlobPart], { type: "application/pdf" });
      pushItem({ name: `${baseName}/작업지시서.pdf`, lastModified: new Date(), input: pdfBlob });
      pushLog("info", "작업지시서.pdf 생성 완료");
    } catch (e) {
      pushLog("warn", `작업지시서.pdf 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Mark pre-skipped indices so ordered emission can advance past them.
    for (const i of preSkippedIdx) markIdx(i, null);



    // Start streaming ZIP producer immediately so PNGs flush as they're made.
    const zipResponse = downloadZip(zipSource());
    // Pick destination: File System Access API (true streaming) or memory blob fallback.
    let writable: FileSystemWritableFileStream | null = null;
    const anyWindow = window as any;
    if (typeof anyWindow.showSaveFilePicker === "function") {
      try {
        const handle = await anyWindow.showSaveFilePicker({
          suggestedName: `${baseName}.zip`,
          types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }],
        });
        writable = await handle.createWritable();
        pushLog("info", "디스크 스트리밍 모드 (저장 위치 선택됨)");
      } catch (e) {
        if ((e as any)?.name === "AbortError") {
          pool.terminate(); setBusy(false);
          pushLog("warn", "사용자가 저장을 취소했습니다");
          return;
        }
        writable = null;
      }
    }
    const pipePromise: Promise<void> = writable
      ? zipResponse.body!.pipeTo(writable as any)
      : (async () => { /* blob fallback handled after producers */ })();

    try {
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            const plan = plans.shift();
            if (!plan) return;
            const { d, fmt, src, idx } = plan;
            try {
              const bundle = await getMask(fmt);
              const task: PoolTask = {
                idx,
                designUid: d.designUid,
                designSrc: src,
                maskKey: useOriginalRes
                  ? `${fmt.widthPt}x${fmt.heightPt}@orig`
                  : `${fmt.widthPt}x${fmt.heightPt}@${dpi}`,
                maskBlob: bundle.blob,
                targetW: bundle.targetW,
                targetH: bundle.targetH,
                widthPt: bundle.widthPt,
                dpi,
                transform,
                footer,
                meta: { tshirtType: d.tshirtType, tshirtColor: d.tshirtColor, tshirtSize: d.tshirtSize },
                useOriginal: useOriginalRes,
              };
              const res = await pool.enqueue(task);
              let blob: Blob;
              if (!res.blob) {
                // Main-thread fallback (preserves sharpen)
                const c0 = await composeClippedDesign(src, fmt.maskCanvas, fmt.widthPt, fmt.heightPt, dpi, transform, { sharpen, useOriginal: useOriginalRes });
                const c = await composeWithFooter(c0, fmt.widthPt, dpi, d.designUid, footer, {
                  tshirtType: d.tshirtType, tshirtColor: d.tshirtColor, tshirtSize: d.tshirtSize,
                });
                blob = await pngWithDpi(await canvasToBlob(c), dpi);
              } else {
                blob = res.blob;
              }
              const seq = String(idx + 1).padStart(padN, "0");
              const designName = sanitizeName(d.designUid) || `item${idx + 1}`;
              markIdx(idx, {
                name: `${baseName}/이미지/${seq}_${designName}.png`,
                lastModified: new Date(),
                input: blob,
              });
              matched++;
            } catch (e) {
              skipped++;
              markIdx(idx, null);
              pushLog("warn", `실패: ${d.designUid} — ${e instanceof Error ? e.message : String(e)}`);
            } finally {
              done++;
              if (done % 5 === 0) {
                pushLog("info", `진행 ${matched + skipped}/${details.length}`);
              }
            }
          }
        }),
      );
      finishProducers();

      if (matched === 0) {
        try { await (writable as any)?.abort?.(); } catch { /* ignore */ }
        pushLog("error", "생성된 파일이 없습니다");
        toast({ title: "일괄 다운로드 실패", description: "모든 항목 생성 실패", variant: "destructive" });
        return;
      }

      pushLog("info", "ZIP 스트리밍 마무리…");
      if (writable) {
        await pipePromise;
      } else {
        // Memory fallback: client-zip writes STORE so size ≈ sum of PNGs.
        const zipBlob = await zipResponse.blob();
        triggerDownload(zipBlob, `${baseName}.zip`);
      }
      pushLog(
        skipped > 0 ? "warn" : "info",
        `일괄 다운로드 완료 (${startedAt} 시작) · 성공 ${matched}개${skipped ? ` · 건너뜀 ${skipped}개` : ""}`,
      );
      toast({
        title: skipped > 0 ? "일부만 다운로드됨" : "일괄 다운로드 완료",
        description: `성공 ${matched}개${skipped ? ` · 건너뜀 ${skipped}개 (상단 로그 확인)` : ""}`,
        variant: skipped > 0 ? "destructive" : "default",
      });
    } catch (e) {
      finishProducers();
      try { await (writable as any)?.abort?.(); } catch { /* ignore */ }
      pushLog("error", `ZIP 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
      toast({ title: "일괄 다운로드 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      pool.terminate();
      setBusy(false);
    }
  };



  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">디자인 시안 설정</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {logs.length > 0 && (
          <div className="rounded border bg-muted/30">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <div className="text-xs font-semibold flex items-center gap-2">
                <span>다운로드 로그</span>
                <Badge variant="outline" className="text-[10px]">{logs.length}</Badge>
                {logs.some((l) => l.level === "error") && (
                  <Badge variant="destructive" className="text-[10px]">오류</Badge>
                )}
                {logs.some((l) => l.level === "warn") && !logs.some((l) => l.level === "error") && (
                  <Badge className="text-[10px] bg-amber-500 hover:bg-amber-500">경고</Badge>
                )}
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setLogs([])}>
                <X className="w-3 h-3 mr-1" /> 지우기
              </Button>
            </div>
            <div className="max-h-40 overflow-auto px-3 py-2 space-y-1 font-mono text-[11px]">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.level === "error" ? "text-destructive" :
                    l.level === "warn" ? "text-amber-600 dark:text-amber-400" :
                    "text-muted-foreground"
                  }
                >
                  <span className="opacity-60">[{l.ts}]</span>{" "}
                  <span className="uppercase">{l.level}</span>{" — "}{l.msg}
                </div>
              ))}
            </div>
          </div>
        )}

        {!outline && formats.length === 0 && (
          <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
            상단의 "디자인 포맷 설정"에서 사이즈별 외곽선 PDF를 먼저 업로드하세요.
          </div>
        )}



        <div className="grid md:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">테스트 디자인 (PNG/JPG) — 삭제하면 원래 디자인이 적용됨</Label>
            <div className="flex gap-2">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTestUpload(f); e.target.value = ""; }}
                className="h-9"
              />
              {testDesign && (
                <Button size="sm" variant="outline" onClick={async () => { setTestDesign(null); setTestName(""); try { await deleteHtPersistedDesign(order.orderNo); } catch {} }}>
                  <X className="w-4 h-4 mr-1" /> {testName || "테스트 제거"}
                </Button>
              )}
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={busy || !outline || !first} onClick={() => first && downloadOne(first)}>
            <Download className="w-4 h-4 mr-1" /> 현재 디자인
          </Button>
          <Button size="sm" disabled={busy || !outline || details.length === 0} onClick={downloadAll}>
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            일괄 다운로드
          </Button>
        </div>

        {/* DPI & 원본 해상도 유지 */}
        <div className="rounded border p-3 space-y-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">출력 해상도 (DPI)</Label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">원본 해상도 유지</span>
              <Switch checked={useOriginalRes} onCheckedChange={setUseOriginalRes} />
            </div>
          </div>
          <div className="grid md:grid-cols-[140px_1fr] gap-3 items-center">
            <Input
              type="number"
              min={72}
              max={1200}
              step={50}
              value={dpiState}
              disabled={useOriginalRes}
              onChange={(e) => setDpi(Number(e.target.value) || 300)}
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              {useOriginalRes
                ? "원본 이미지 픽셀 그대로 사용합니다. 리샘플링 없음 — 파일 용량 최소. 마스크/푸터(QR·고유번호)만 합성됩니다. (DPI 메타데이터는 표시용으로 위 값을 사용)"
                : "기본 300DPI 권장. API로 들어오는 이미지가 이미 300DPI에 맞춰져 있다면 '원본 해상도 유지'를 켜면 업스케일링이 일어나지 않아 용량이 크게 줄어듭니다 (예: 600DPI → 300DPI는 약 1/4 용량)."}
            </p>
          </div>
        </div>

        {/* Design transform within fixed format (offset + proportional scale) */}

        <div className="rounded border p-3 space-y-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">디자인 위치/크기 조정 (포맷 고정)</Label>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => { setOffsetX(0); setOffsetY(0); setDesignScale(1); }}>
                초기화
              </Button>
              <Button size="sm" className="h-7 text-xs"
                onClick={() => {
                  writeHtDesignUiDraft(order.orderNo, { offsetX, offsetY, designScale });
                  try { window.dispatchEvent(new CustomEvent("htf:transformSaved", { detail: { orderNo: order.orderNo } })); } catch {}
                  toast({ title: "저장됨", description: "디자인 위치/크기 값이 일괄 적용됩니다." });
                }}>
                <Save className="w-3.5 h-3.5 mr-1" /> 저장
              </Button>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>좌우 (X)</span><span className="font-mono">{offsetX.toFixed(0)}%</span>
              </div>
              <Slider value={[offsetX]} min={-100} max={100} step={1} onValueChange={(v) => setOffsetX(v[0])} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>상하 (Y)</span><span className="font-mono">{offsetY.toFixed(0)}%</span>
              </div>
              <Slider value={[offsetY]} min={-100} max={100} step={1} onValueChange={(v) => setOffsetY(v[0])} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>크기 (비율 유지)</span><span className="font-mono">{(designScale * 100).toFixed(0)}%</span>
              </div>
              <Slider value={[designScale]} min={0.2} max={3} step={0.01} onValueChange={(v) => setDesignScale(v[0])} />
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-2">
            <Input type="number" value={offsetX} step={1} onChange={(e) => setOffsetX(Number(e.target.value) || 0)} className="h-8 text-xs" />
            <Input type="number" value={offsetY} step={1} onChange={(e) => setOffsetY(Number(e.target.value) || 0)} className="h-8 text-xs" />
            <Input type="number" value={designScale} step={0.05} min={0.1} max={5} onChange={(e) => setDesignScale(Math.max(0.1, Number(e.target.value) || 1))} className="h-8 text-xs" />
          </div>
        </div>

        {/* Footer (UID + QR) config */}
        <div className="rounded border p-3 space-y-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold flex items-center gap-2">
              <QrCodeIcon className="w-3.5 h-3.5" /> 하단 고유번호 · QR코드 설정
            </Label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={footer.enabled}
                  onChange={(e) => setFooter({ ...footer, enabled: e.target.checked })}
                />
                포함
              </label>
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => {
                  setFooter(DEFAULT_FOOTER_CFG);
                  try { localStorage.removeItem(FOOTER_STORAGE_KEY); } catch {}
                }}>초기화</Button>
              <Button size="sm" className="h-7 text-xs"
                onClick={() => {
                  try {
                    localStorage.setItem(FOOTER_STORAGE_KEY, JSON.stringify(footer));
                    toast({ title: "저장됨", description: "QR·고유번호 설정이 저장되었습니다." });
                  } catch (e: any) {
                    toast({ title: "저장 실패", description: e?.message || "", variant: "destructive" });
                  }
                }}>저장</Button>
            </div>
          </div>
          <div className="grid md:grid-cols-5 gap-3">
            <NumField label="QR 크기 (mm)" v={footer.qrSizeMm}
              set={(v) => setFooter({ ...footer, qrSizeMm: v })} min={3} max={80} step={0.5} />
            <NumField label="고유번호 크기 (mm)" v={footer.textSizeMm}
              set={(v) => setFooter({ ...footer, textSizeMm: v })} min={1} max={40} step={0.1} />
            <NumField label="QR-고유번호 간격 (mm)" v={footer.gapMm}
              set={(v) => setFooter({ ...footer, gapMm: v })} min={0} max={30} step={0.1} />
            <NumField label="하단 여백 (mm)" v={footer.bottomPaddingMm}
              set={(v) => setFooter({ ...footer, bottomPaddingMm: v })} min={0} max={30} step={0.1} />
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>수평 위치</span>
                <span className="font-mono">
                  {footer.offsetXPct === 0 ? "중앙" : footer.offsetXPct < 0 ? `좌 ${Math.abs(footer.offsetXPct)}%` : `우 ${footer.offsetXPct}%`}
                </span>
              </div>
              <Slider value={[footer.offsetXPct]} min={-100} max={100} step={1}
                onValueChange={(v) => setFooter({ ...footer, offsetXPct: v[0] })} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            미리보기·다운로드 모두 적용됩니다. 고유번호 텍스트는 입력한 "테스트 디자인 고유번호"로 미리 확인할 수 있고, 일괄/개별 다운로드에서는 각 항목의 실제 디자인 고유번호가 사용됩니다.
          </p>
        </div>



        {(() => {
          const wMm = outline ? outline.widthPt / 72 * 25.4 : 0;
          const hMm = outline ? outline.heightPt / 72 * 25.4 : 0;
          const sizeLabel = outline ? `${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm` : "—";
          const ratio = outline ? `${outline.widthPt} / ${outline.heightPt}` : "1 / 1";
          return (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">외곽선</span>
                  <span className="text-xs font-mono text-foreground">실제 인쇄크기: {sizeLabel}</span>
                </div>
                <div
                  className="w-full rounded border bg-muted/30 flex items-center justify-center overflow-hidden"
                  style={{ aspectRatio: ratio }}
                >
                  {outline ? <img src={outline.previewUrl} alt="외곽선" className="max-w-full max-h-full object-contain" /> :
                    <span className="text-xs text-muted-foreground">—</span>}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">
                    미리보기 ({first?.designUid || "—"}){testDesign ? " · 테스트 디자인" : ""}
                  </span>
                  <span className="text-xs font-mono text-foreground">실제 인쇄크기: {sizeLabel}</span>
                </div>
                <div
                  className="w-full rounded border bg-[conic-gradient(at_50%_50%,#eee_25%,#fff_0_50%,#eee_0_75%,#fff_0)] bg-[length:16px_16px] flex items-center justify-center overflow-hidden"
                  style={{ aspectRatio: ratio }}
                >
                  {previewUrl ? <img src={previewUrl} alt="미리보기" className="max-w-full max-h-full object-contain" /> :
                    <span className="text-xs text-muted-foreground">미리보기 없음</span>}
                </div>
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

// ============ QR tab ============

interface QrConfig {
  sizeMm: number;       // QR 본체 크기 (mm)
  marginMm: number;     // 외곽 여백 (mm)
  textSizeMm: number;   // 텍스트 높이 (mm)
  gapMm: number;        // QR과 텍스트 간격 (mm)
}

const QR_DPI = 300;
const mmToPx = (mm: number) => Math.max(1, Math.round((mm / 25.4) * QR_DPI));

async function buildQrPng(value: string, cfg: QrConfig): Promise<HTMLCanvasElement> {
  const qrPx = mmToPx(cfg.sizeMm);
  const marginPx = mmToPx(cfg.marginMm);
  const textPx = cfg.textSizeMm > 0 ? mmToPx(cfg.textSizeMm) : 0;
  const gapPx = cfg.gapMm > 0 ? mmToPx(cfg.gapMm) : 0;

  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, value, { width: qrPx, margin: 0 });

  const textBlock = textPx > 0 ? textPx + Math.round(textPx * 0.3) : 0;
  const out = document.createElement("canvas");
  out.width = Math.max(qrCanvas.width + marginPx * 2, marginPx * 2 + Math.ceil(value.length * textPx * 0.65));
  out.height = marginPx * 2 + qrCanvas.height + (textBlock > 0 ? gapPx + textBlock : 0);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(qrCanvas, (out.width - qrCanvas.width) / 2, marginPx);
  if (textBlock > 0) {
    ctx.fillStyle = "#000000";
    ctx.font = `${textPx}px ui-monospace, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(value, out.width / 2, marginPx + qrCanvas.height + gapPx);
  }
  return out;
}

function QrTab({ details }: { details: DesignDetail[] }) {
  const [cfg, setCfg] = useState<QrConfig>({ sizeMm: 25, marginMm: 2, textSizeMm: 3, gapMm: 1.5 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = details[0];

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!first) return;
      const c = await buildQrPng(first.designUid, cfg);
      if (!cancelled) setPreviewUrl(c.toDataURL("image/png"));
    }
    run();
    return () => { cancelled = true; };
  }, [first?.designUid, cfg.sizeMm, cfg.marginMm, cfg.textSizeMm, cfg.gapMm]);

  const downloadAll = async () => {
    setBusy(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`qrcode_${first?.orderNo || "order"}`)!;
      const used = new Map<string, number>();
      for (const d of details) {
        const c = await buildQrPng(d.designUid, cfg);
        const b = await pngWithDpi(await canvasToBlob(c), QR_DPI);
        const count = used.get(d.designUid) ?? 0;
        const name = count === 0 ? `${d.designUid}.png` : `${d.designUid}(${count}).png`;
        used.set(d.designUid, count + 1);
        folder.file(name, b);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload(blob, `qrcode_${first?.orderNo || "order"}.zip`);
      toast({ title: "QR 폴더 다운로드 완료", description: `${details.length}개` });
    } finally { setBusy(false); }
  };

  const totalW = cfg.sizeMm + cfg.marginMm * 2;
  const totalH = cfg.sizeMm + cfg.marginMm * 2 + cfg.gapMm + cfg.textSizeMm * 1.3;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><QrCodeIcon className="w-4 h-4" /> 큐알코드 시안</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-4 gap-3">
          <NumField label="QR 크기 (mm)" v={cfg.sizeMm} set={(v) => setCfg({ ...cfg, sizeMm: v })} min={5} max={200} step={0.5} />
          <NumField label="여백 (mm)" v={cfg.marginMm} set={(v) => setCfg({ ...cfg, marginMm: v })} min={0} max={20} step={0.5} />
          <NumField label="텍스트 크기 (mm)" v={cfg.textSizeMm} set={(v) => setCfg({ ...cfg, textSizeMm: v })} min={0} max={20} step={0.1} />
          <NumField label="QR-텍스트 간격 (mm)" v={cfg.gapMm} set={(v) => setCfg({ ...cfg, gapMm: v })} min={0} max={20} step={0.1} />
        </div>

        <div className="grid md:grid-cols-2 gap-4 items-start">
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              미리보기 ({first?.designUid || "—"}) · 실제 인쇄 크기 약 {totalW.toFixed(1)} × {totalH.toFixed(1)} mm @ {QR_DPI}DPI
            </div>
            <div className="rounded border bg-muted/30 p-4 flex items-center justify-center min-h-64">
              {previewUrl ? <img src={previewUrl} alt="qr" className="max-w-full max-h-[400px] object-contain" /> :
                <span className="text-xs text-muted-foreground">—</span>}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">QR 코드는 디자인 고유번호(작업번호-순번)를 값으로 사용하며, 하단에 동일한 텍스트가 표기됩니다. 모든 치수는 mm 단위이며 {QR_DPI}DPI 메타데이터가 포함되어 일러스트레이터에서도 실제 인쇄 크기로 열립니다.</p>
            <Button onClick={downloadAll} disabled={busy || details.length === 0}>
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
              폴더로 일괄 다운로드 (ZIP)
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NumField({ label, v, set, min, max, step }: { label: string; v: number; set: (n: number) => void; min: number; max: number; step?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={min} max={max} step={step ?? 1} value={v} onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || min)))} className="h-9" />
    </div>
  );
}

// ============ order detail list ============

function OrderDetailList({
  details, outline, formats,
}: {
  details: DesignDetail[];
  outline: { previewUrl: string; maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number; name: string } | null;
  formats: SizedFormat[];
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">주문 상세 목록</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">순번</TableHead>
              <TableHead>주문번호</TableHead>
              <TableHead>디자인고유번호</TableHead>
              <TableHead>티셔츠 종류</TableHead>
              <TableHead>티셔츠 컬러</TableHead>
              <TableHead>티셔츠 사이즈</TableHead>
              <TableHead>디자인</TableHead>
              <TableHead>QR코드</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {details.map((d) => {
              const fmt = pickFormatForSize(formats, d.tshirtSize || "", outline);
              return (
                <TableRow key={d.designUid}>
                  <TableCell>{d.serial}</TableCell>
                  <TableCell className="font-mono">{d.orderNo}</TableCell>
                  <TableCell className="font-mono">{d.designUid}</TableCell>
                  <TableCell>{d.tshirtType || "—"}</TableCell>
                  <TableCell>{d.tshirtColor || "—"}</TableCell>
                  <TableCell>{d.tshirtSize || "—"}</TableCell>
                  <TableCell><DesignThumb detail={d} outline={fmt} /></TableCell>
                  <TableCell><QrThumb value={d.designUid} /></TableCell>
                </TableRow>
              );
            })}
            {details.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">—</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DesignThumb({
  detail, outline,
}: {
  detail: DesignDetail;
  outline: { maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number } | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!outline || !detail.designSrc) { setUrl(detail.designSrc); return; }
      try {
        const c = await composeClippedDesign(detail.designSrc, outline.maskCanvas, outline.widthPt, outline.heightPt, 72);
        if (!cancelled) setUrl(c.toDataURL("image/png"));
      } catch { /* ignore */ }
    }
    run();
    return () => { cancelled = true; };
  }, [detail.designSrc, outline]);
  return (
    <div className="w-16 h-16 rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
      {url ? <img src={url} alt="d" className="max-w-full max-h-full object-contain" /> : <span className="text-[10px] text-muted-foreground">—</span>}
    </div>
  );
}

function QrThumb({ value }: { value: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { width: 96, margin: 1 }).then(setUrl).catch(() => {});
  }, [value]);
  return (
    <div className="w-16 h-16 rounded border bg-white flex items-center justify-center overflow-hidden">
      {url ? <img src={url} alt="qr" className="max-w-full max-h-full" /> : <span className="text-[10px] text-muted-foreground">—</span>}
    </div>
  );
}
