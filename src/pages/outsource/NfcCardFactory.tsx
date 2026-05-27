import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
(pdfjsLib as any).GlobalWorkerOptions.workerPort = new PdfWorker();

import PageHeader from "@/components/PageHeader";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Download, Eye, FileText, Loader2, Upload, X, ChevronLeft, Save, Image as ImageIcon } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import bwipjs from "bwip-js/browser";
import { CardFrame, CARD_W_MM, CARD_H_MM } from "@/components/outsource/CardFrame";

const MM = 2.8346456693; // 1mm in pt
// 프레임/PDF 원본 크기 그대로 사용 — 별도 여백 보정 없음.
const DEFAULT_FRAME_BLEED_MM = 0;
const FRAME_BUCKET = "design-formats";
const TEST_IMG_PREFIX = "nfc-card-test";
const SETTINGS_KEY_PREFIX = "outsource-nfc-card-v1";
const GLOBAL_LAYOUT_KEY = "outsource-nfc-card-layout-default";
const CARD_SIZE_KEY = "outsource-nfc-card-size";
const TEST_TWINCODE_PREFIX = "nfc-card-test";

interface CardSize { width: number; height: number }
const DEFAULT_CARD_SIZE: CardSize = { width: CARD_W_MM, height: CARD_H_MM };

// ===== Master font options (상업적 사용 가능 / commercial-free Korean gothic) =====
interface FontOption {
  id: string;
  label: string;
  css: string;        // CSS font-family stack (preview)
  cssLink: string;    // <link rel=stylesheet> href to register family in browser
}
const FONT_OPTIONS: FontOption[] = [
  {
    id: "pretendard",
    label: "Pretendard",
    css: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
    cssLink: "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css",
  },
  {
    id: "ibm-plex-sans-kr",
    label: "IBM Plex Sans KR",
    css: "'IBM Plex Sans KR', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;700&display=swap",
  },
  {
    id: "spoqa-han-sans-neo",
    label: "Spoqa Han Sans Neo",
    css: "'Spoqa Han Sans Neo', sans-serif",
    cssLink: "https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans/css/SpoqaHanSansNeo.css",
  },
  {
    id: "black-han-sans",
    label: "Black Han Sans (블랙한산스 · Bold)",
    css: "'Black Han Sans', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap",
  },
  {
    id: "do-hyeon",
    label: "Do Hyeon (도현체 · Bold)",
    css: "'Do Hyeon', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Do+Hyeon&display=swap",
  },
];
const DEFAULT_MASTER_FONT = "pretendard";
const FONT_WEIGHTS: { value: number; label: string }[] = [
  { value: 300, label: "300 Light" },
  { value: 400, label: "400 Regular" },
  { value: 500, label: "500 Medium" },
  { value: 600, label: "600 Semibold" },
  { value: 700, label: "700 Bold" },
  { value: 800, label: "800 Extrabold" },
  { value: 900, label: "900 Black" },
];
const DEFAULT_MASTER_FONT_WEIGHT = 500;

const _fontBytesCache = new Map<string, Uint8Array>();
async function fetchFontBytes(url: string, _which?: "reg" | "bold"): Promise<Uint8Array | null> {
  try {
    const cached = _fontBytesCache.get(url);
    if (cached) return cached;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const sig = String.fromCharCode(...buf.slice(0, 4));
    // pdf-lib/fontkit in the browser can throw "Not a CFF Font" for OTF/CFF fonts.
    // Use only TrueType-flavored fonts for PDF embedding.
    if (sig === "OTTO") return null;
    _fontBytesCache.set(url, buf);
    return buf;
  } catch { return null; }
}

async function renderPdfFirstPagePng(bytes: Uint8Array): Promise<{ dataUrl: string; aspect: number; maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number }> {
  const doc = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return { dataUrl: canvas.toDataURL("image/png"), aspect: viewport.width / viewport.height, maskCanvas: canvas, widthPt: vp1.width, heightPt: vp1.height };
}

async function loadImage(src: string, crossOrigin: string | null = "anonymous"): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function inferImageMime(url: string, bytes: Uint8Array, contentType?: string | null): string {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  if (ct.startsWith("image/")) return ct;
  const lower = url.toLowerCase().split("?")[0];
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (lower.endsWith(".svg") || new TextDecoder().decode(bytes.slice(0, 160)).trimStart().match(/^<\?xml|^<svg/i)) {
    return "image/svg+xml;charset=utf-8";
  }
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function loadFetchedImage(url: string): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = inferImageMime(url, bytes, res.headers.get("content-type"));
  const objUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const img = await loadImage(objUrl, null);
    return { img, revoke: () => URL.revokeObjectURL(objUrl) };
  } catch (e) {
    URL.revokeObjectURL(objUrl);
    throw e;
  }
}

function drawImageContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }, x: number, y: number, w: number, h: number) {
  const iw = Number(img.naturalWidth || img.width || w);
  const ih = Number(img.naturalHeight || img.height || h);
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function detectInsetContentRect(
  img: HTMLImageElement,
  targetAspect: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;

  const maxProbe = 420;
  const scale = Math.min(1, maxProbe / Math.max(iw, ih));
  const pw = Math.max(1, Math.round(iw * scale));
  const ph = Math.max(1, Math.round(ih * scale));
  const probe = document.createElement("canvas");
  probe.width = pw;
  probe.height = ph;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  if (!pctx) return null;
  pctx.drawImage(img, 0, 0, pw, ph);

  let minX = pw, minY = ph, maxX = -1, maxY = -1;
  const data = pctx.getImageData(0, 0, pw, ph).data;
  for (let y = 0; y < ph; y += 1) {
    for (let x = 0; x < pw; x += 1) {
      const i = (y * pw + x) * 4;
      const a = data[i + 3];
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (a > 20 && (r < 246 || g < 246 || b < 246)) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const contentW = maxX - minX + 1;
  const contentH = maxY - minY + 1;
  if (contentW / pw > 0.84 && contentH / ph > 0.84) return null;

  const pad = Math.round(Math.max(contentW, contentH) * 0.035);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(pw - 1, maxX + pad); maxY = Math.min(ph - 1, maxY + pad);

  let cx = (minX + maxX) / 2;
  let cy = (minY + maxY) / 2;
  let cw = maxX - minX + 1;
  let ch = maxY - minY + 1;
  if (cw / ch > targetAspect) ch = cw / targetAspect;
  else cw = ch * targetAspect;
  cw = Math.min(cw, pw); ch = Math.min(ch, ph);
  let sx = Math.max(0, Math.min(pw - cw, cx - cw / 2));
  let sy = Math.max(0, Math.min(ph - ch, cy - ch / 2));
  return { sx: sx / scale, sy: sy / scale, sw: cw / scale, sh: ch / scale };
}

async function composeMaskedCardCanvas(
  designSrc: string,
  maskCanvas: HTMLCanvasElement | null,
  targetW: number,
  targetH: number,
): Promise<HTMLCanvasElement> {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(targetW));
  out.height = Math.max(1, Math.round(targetH));
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";

  const img = await loadImage(designSrc);
  const crop = detectInsetContentRect(img, out.width / out.height);
  const sx = crop?.sx ?? 0;
  const sy = crop?.sy ?? 0;
  const sw = crop?.sw ?? (img.naturalWidth || img.width);
  const sh = crop?.sh ?? (img.naturalHeight || img.height);
  const scale = Math.max(out.width / sw, out.height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  octx.drawImage(img, sx, sy, sw, sh, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);

  if (maskCanvas) {
    const mask = document.createElement("canvas");
    mask.width = out.width;
    mask.height = out.height;
    const mctx = mask.getContext("2d")!;
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = "high";
    mctx.drawImage(maskCanvas, 0, 0, out.width, out.height);
    const md = mctx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < md.data.length; i += 4) {
      const r = md.data[i], g = md.data[i + 1], b = md.data[i + 2], a = md.data[i + 3];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const inside = (1 - lum) * (a / 255);
      md.data[i] = 0; md.data[i + 1] = 0; md.data[i + 2] = 0;
      md.data[i + 3] = Math.round(Math.min(1, Math.max(0, inside)) * 255);
    }
    mctx.putImageData(md, 0, 0);
    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(mask, 0, 0);
    octx.globalCompositeOperation = "source-over";
  }

  return out;
}

function fmtDate(v?: string | null): string {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v).slice(0, 10); }
}

function tsName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

type OptionKey =
  | "cpValue" | "editionNo"
  | "issuedNo" | "mintedOn" | "grade" | "issuedBy" | "twincode" | "dmBarcode"
  | "companyName" | "centerSlogan" | "nfcEnabled";

interface OptionLayout {
  enabled: boolean;
  x: number;      // mm from left
  y: number;      // mm from top
  w: number;      // mm
  h: number;      // mm (for images/svg); text uses fontSize
  fontSize: number; // mm (text height)
  centerX: boolean; // 가로정렬(중앙)
  centerY: boolean; // 세로정렬(중앙)
  padding?: number; // mm — DM 바코드 흰 여백 (quiet zone)
}

const FRONT_KEYS: OptionKey[] = ["cpValue", "editionNo"];
const BACK_KEYS: OptionKey[] = ["issuedNo", "mintedOn", "grade", "issuedBy", "twincode", "dmBarcode", "companyName", "centerSlogan", "nfcEnabled"];

const OPTION_LABELS: Record<OptionKey, string> = {
  cpValue: "CP값",
  editionNo: "EDITION No.",
  issuedNo: "ISSUED No.",
  mintedOn: "Minted on",
  grade: "등급",
  issuedBy: "ISSUED BY",
  twincode: "트윈코드",
  dmBarcode: "DM 바코드",
  companyName: "회사명",
  centerSlogan: "중앙슬로건",
  nfcEnabled: "NFC Enabled",
};

const DEFAULT_BACK_DEFAULTS = {
  companyName: "TWINMETA",
  centerSlogan: "THE ORIGINAL",
  nfcEnabled: "NFC Enabled",
  issuedBy: "ISSUED BY",
};

const DEFAULT_LAYOUT: Record<OptionKey, OptionLayout> = {
  cpValue:     { enabled: true, x: 10, y: 10,  w: 30, h: 8,  fontSize: 4, centerX: false, centerY: false },
  editionNo:   { enabled: true, x: 10, y: 40,  w: 30, h: 6,  fontSize: 3.5, centerX: false, centerY: false },
  issuedNo:    { enabled: true, x: 5,  y: 5,   w: 30, h: 5,  fontSize: 3,   centerX: false, centerY: false },
  mintedOn:    { enabled: true, x: 5,  y: 12,  w: 35, h: 5,  fontSize: 3,   centerX: false, centerY: false },
  grade:       { enabled: true, x: 55, y: 5,   w: 25, h: 6,  fontSize: 4,   centerX: false, centerY: false },
  issuedBy:    { enabled: true, x: 55, y: 35,  w: 25, h: 12, fontSize: 3, centerX: false, centerY: false },
  twincode:    { enabled: true, x: 5,  y: 25,  w: 14, h: 14, fontSize: 0,   centerX: false, centerY: false },
  dmBarcode:   { enabled: true, x: 60, y: 18,  w: 14, h: 14, fontSize: 0,   centerX: false, centerY: false, padding: 0.5 },
  companyName: { enabled: true, x: 5,  y: 75,  w: 47, h: 5,  fontSize: 3,   centerX: true,  centerY: false },
  centerSlogan:{ enabled: true, x: 5,  y: 50,  w: 47, h: 5,  fontSize: 3.5, centerX: true,  centerY: false },
  nfcEnabled:  { enabled: true, x: 5,  y: 82,  w: 47, h: 4,  fontSize: 2.5, centerX: true,  centerY: false },
};

function alignForOption(key: OptionKey): "left" | "center" | "right" {
  switch (key) {
    case "cpValue":
    case "grade":
    case "centerSlogan": return "center";
    case "editionNo":
    case "mintedOn":
    case "nfcEnabled":   return "right";
    default:              return "left";
  }
}

function textWeightForOption(key: OptionKey, masterWeight: number) {
  return key === "grade" ? Math.max(700, masterWeight) : masterWeight;
}

function drawCanvasTextElement(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  fontPx: number,
  fontCss: string,
  weight: number,
  align: "left" | "center" | "right",
) {
  ctx.save();
  ctx.font = `${weight} ${fontPx}px ${fontCss}`;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  const textW = ctx.measureText(text).width;
  let drawX = x;
  if (align === "center") drawX = x + (w - textW) / 2;
  else if (align === "right") drawX = x + w - textW;
  ctx.fillText(text, drawX, y);
  ctx.restore();
}

/**
 * 모든 텍스트 박스의 너비/높이를 글자 크기에 맞춰 자동 산출.
 * - 너비: 실제 텍스트 측정 너비(mm)
 * - 높이: fontSize(mm)
 * 이미지(twincode/dmBarcode)는 사용자가 지정한 cfg.w/cfg.h 사용.
 */
const __measureCtx: CanvasRenderingContext2D | null =
  typeof document !== "undefined"
    ? (document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D | null)
    : null;
function measureTextWidthMm(text: string, fontSizeMm: number, fontCss: string, weight: number): number {
  if (!__measureCtx || !text) return 0;
  const pxPerMm = 300 / 25.4;
  const fontPx = Math.max(4, fontSizeMm * pxPerMm);
  __measureCtx.font = `${weight} ${fontPx}px ${fontCss}`;
  return __measureCtx.measureText(text).width / pxPerMm;
}
function isTextOption(key: OptionKey): boolean {
  return key !== "twincode" && key !== "dmBarcode";
}

interface CardData {
  seq: number;
  orderNo: string;
  uniqueNo: string;           // orderNo-4
  uid: string;                // arbitrary UID info
  cpValue: string;
  editionNo: string;
  issuedNo: string;
  mintedOn: string;
  grade: string;
  issuedByUrl: string | null;
  twincodeSvgUrl: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
}




interface TestAsset {
  url: string;
  name: string;
  path?: string;
  objectUrl?: boolean;
}

function revokeTestAsset(asset: TestAsset | null | undefined) {
  if (asset?.objectUrl && asset.url.startsWith("blob:")) URL.revokeObjectURL(asset.url);
}

interface OrderRow {
  orderNo: string;
  receivedAt: string;
  dueDate: string;
  recipient: string;
  quantity: number;
}

// ---------- DataMatrix via bwip-js → PNG bytes ----------
async function dataMatrixPngBytes(text: string, sizePx = 300): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  await (bwipjs as any).toCanvas(canvas, {
    bcid: "datamatrix",
    text: text || "TWINMETA",
    scale: 4,
    paddingwidth: 0,
    paddingheight: 0,
    includetext: false,
  });
  // re-render at sizePx
  const out = document.createElement("canvas");
  out.width = sizePx; out.height = sizePx;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sizePx, sizePx);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, sizePx, sizePx);
  const dataUrl = out.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function urlToPngBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return buf;
  // If it is SVG/JPG/WebP/etc, re-render via canvas with a proper MIME type.
  const blob = new Blob([buf as BlobPart], { type: inferImageMime(url, buf, res.headers.get("content-type")) });
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("img decode failed"));
      i.src = objUrl;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || 400;
    c.height = img.naturalHeight || 400;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const dataUrl = c.toDataURL("image/png");
    const bin = atob(dataUrl.split(",")[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const dataUrl = canvas.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function downloadBlob(bytes: Uint8Array, filename: string, mime = "application/pdf") {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============== MAIN ==============
export default function NfcCardFactory() {
  const { t } = useLang();
  const { user } = useAuth();
  const { data: ordersData, isLoading } = useOrders();
  const [detailOrderNo, setDetailOrderNo] = useState<string | null>(null);
  const [cardSize, setCardSize] = useState<CardSize>(DEFAULT_CARD_SIZE);
  const [sizeDraft, setSizeDraft] = useState<{ width: string; height: string }>({
    width: String(DEFAULT_CARD_SIZE.width),
    height: String(DEFAULT_CARD_SIZE.height),
  });
  const [sizeSaving, setSizeSaving] = useState(false);

  // Load saved card size from user_ui_settings
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_ui_settings")
        .select("setting_value")
        .eq("user_id", user.id)
        .eq("setting_key", CARD_SIZE_KEY)
        .maybeSingle();
      if (cancelled) return;
      const v = data?.setting_value as any;
      if (v && Number(v.width) > 0 && Number(v.height) > 0) {
        const sz = { width: Number(v.width), height: Number(v.height) };
        setCardSize(sz);
        setSizeDraft({ width: String(sz.width), height: String(sz.height) });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const saveCardSize = async () => {
    if (!user?.id) { toast({ title: "로그인 필요", variant: "destructive" }); return; }
    const w = Number(sizeDraft.width);
    const h = Number(sizeDraft.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      toast({ title: "유효한 가로/세로(mm) 값을 입력하세요", variant: "destructive" });
      return;
    }
    setSizeSaving(true);
    const { error } = await supabase
      .from("user_ui_settings")
      .upsert(
        [{ user_id: user.id, setting_key: CARD_SIZE_KEY, setting_value: { width: w, height: h } }],
        { onConflict: "user_id,setting_key" },
      );
    setSizeSaving(false);
    if (error) { toast({ title: "저장 실패", description: error.message, variant: "destructive" }); return; }
    setCardSize({ width: w, height: h });
    toast({ title: "카드 사이즈 저장됨", description: `${w} × ${h} mm` });
  };

  const rows: OrderRow[] = useMemo(() => {
    if (!ordersData) return [];
    return (ordersData as any[]).map(o => ({
      orderNo: o.external_order_id,
      receivedAt: fmtDate(o.created_at),
      dueDate: fmtDate(o.project_completed_at),
      recipient: o.recipient_name || "",
      quantity: o.quantity || 0,
    })).sort((a, b) => a.orderNo.localeCompare(b.orderNo));
  }, [ordersData]);

  if (detailOrderNo) {
    return (
      <DetailView
        orderNo={detailOrderNo}
        order={(ordersData as any[])?.find(o => o.external_order_id === detailOrderNo)}
        cardSize={cardSize}
        onBack={() => setDetailOrderNo(null)}
        userId={user?.id}
      />
    );
  }

  return (
    <div>
      <PageHeader title="NFC 카드 공장" description="카드 사이즈 설정 및 옵션 배치 · PDF 발주" />
      <div className="p-6 space-y-4">
        {/* Card size setting */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
              <span>카드 사이즈 설정</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                현재 적용: <span className="font-mono text-foreground">{cardSize.width} × {cardSize.height} mm</span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">가로 (mm)</Label>
                <Input
                  type="number" step="0.1" min="1"
                  value={sizeDraft.width}
                  onChange={e => setSizeDraft(p => ({ ...p, width: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">세로 (mm)</Label>
                <Input
                  type="number" step="0.1" min="1"
                  value={sizeDraft.height}
                  onChange={e => setSizeDraft(p => ({ ...p, height: e.target.value }))}
                />
              </div>
              <Button onClick={saveCardSize} disabled={sizeSaving}>
                {sizeSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                저장
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              저장한 사이즈가 주문 상세의 카드 미리보기 · PDF 출력 크기에 적용됩니다.
            </p>
          </CardContent>
        </Card>


        {/* Order list */}
        <Card>
          <CardHeader><CardTitle className="text-base">주문 목록</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>작업번호</TableHead>
                  <TableHead>주문접수일</TableHead>
                  <TableHead>납기일</TableHead>
                  <TableHead>트윈커</TableHead>
                  <TableHead className="text-right">작업수량</TableHead>
                  <TableHead className="text-right">상세보기</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">로딩 중...</TableCell></TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">주문 데이터가 없습니다</TableCell></TableRow>
                )}
                {rows.map(r => (
                  <TableRow key={r.orderNo}>
                    <TableCell className="font-mono">{r.orderNo}</TableCell>
                    <TableCell>{r.receivedAt}</TableCell>
                    <TableCell>{r.dueDate || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>{r.recipient}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetailOrderNo(r.orderNo)}>
                        <Eye className="w-4 h-4 mr-1" />상세보기
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============== DETAIL VIEW ==============
function DetailView({
  orderNo, order, cardSize, onBack, userId,
}: {
  orderNo: string;
  order: any;
  cardSize: CardSize;
  onBack: () => void;
  userId?: string;
}) {
  // Build cards array from order
  const cards: CardData[] = useMemo(() => {
    if (!order) return [];
    const items: any[] = Array.isArray(order.source_data?.items) ? order.source_data.items : [];
    const count = Math.max(items.length, order.quantity || 1);
    const uniqueNo = `${orderNo}-4`;
    return Array.from({ length: count }, (_, idx) => {
      const it = items[idx] || {};
      const sd = order.source_data || {};
      return {
        seq: idx + 1,
        orderNo,
        uniqueNo,
        uid: String(it.uid ?? it.UID ?? sd.uid ?? `${orderNo}-${idx + 1}`),
        cpValue: String(it.cp ?? it.cp_value ?? sd.cp_value ?? sd.cp ?? ""),
        editionNo: String(it.edition_no ?? it.edition ?? sd.edition_no ?? `${idx + 1}`),
        issuedNo: String(it.issued_no ?? sd.issued_no ?? `${idx + 1}`),
        mintedOn: String(it.minted_on ?? sd.minted_on ?? fmtDate(order.created_at)),
        grade: String(it.grade ?? sd.grade ?? order.grade ?? "COMMON").toUpperCase(),
        issuedByUrl: it.issued_by_url ?? sd.issued_by_url ?? null,
        twincodeSvgUrl: it.twincode_svg_url ?? it.svg_url ?? sd.twincode_svg_url ?? null,
        frontImageUrl: it.card_front_url ?? sd.card_front_url ?? null,
        backImageUrl: it.card_back_url ?? sd.card_back_url ?? null,
      };
    });
  }, [order, orderNo]);

  const [layoutFront, setLayoutFront] = useState<Record<OptionKey, OptionLayout>>(() => {
    const def: any = {};
    FRONT_KEYS.forEach(k => def[k] = { ...DEFAULT_LAYOUT[k] });
    return def;
  });
  const [layoutBack, setLayoutBack] = useState<Record<OptionKey, OptionLayout>>(() => {
    const def: any = {};
    BACK_KEYS.forEach(k => def[k] = { ...DEFAULT_LAYOUT[k] });
    return def;
  });
  const [workOrder, setWorkOrder] = useState({
    company: "TWINMETA",
    orderNo,
    orderDate: fmtDate(order?.created_at),
    deliveryDate: fmtDate(order?.project_completed_at),
    quantity: cards.length,
    recipient: "TWINMETA",
    phone: "18562757070",
    address: "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Test images per side (server-persisted; falls back to API card image when removed)
  const [testImages, setTestImages] = useState<{
    front: TestAsset | null;
    back: TestAsset | null;
  }>({ front: null, back: null });

  // Test twincode SVG (server-persisted; falls back to API twincodeSvgUrl when removed)
  const [testTwincodeSvg, setTestTwincodeSvg] = useState<{ url: string; name: string } | null>(null);

  // Test values for preview only (override card[0] for front/back fields)
  const [testValues, setTestValues] = useState({
    cpValue: "", editionNo: "", issuedNo: "", mintedOn: "", grade: "",
  });

  // 카드 뒷면 기본 텍스트 (API 외 전체 카드에 공통 적용)
  const [backDefaults, setBackDefaults] = useState({ ...DEFAULT_BACK_DEFAULTS });

  // 마스터 글자꼴 (선택 시 카드 텍스트/숫자 미리보기 + PDF에 자동 적용)
  const [masterFont, setMasterFont] = useState<string>(DEFAULT_MASTER_FONT);
  const [masterFontWeight, setMasterFontWeight] = useState<number>(DEFAULT_MASTER_FONT_WEIGHT);
  const currentFont = FONT_OPTIONS.find(f => f.id === masterFont) ?? FONT_OPTIONS[0];

  // 브라우저 미리보기용: 선택 가능한 모든 폰트의 웹 CSS 를 한 번만 주입
  useEffect(() => {
    FONT_OPTIONS.forEach(f => {
      const id = `nfc-font-css-${f.id}`;
      if (document.getElementById(id)) return;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = f.cssLink;
      document.head.appendChild(link);
    });
  }, []);

  // 외곽 여백(bleed) 고정값(mm) — 미리보기/PDF 동일하게 사용
  const bleedMm = DEFAULT_FRAME_BLEED_MM;

  // Load test images from storage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: list } = await supabase.storage.from(FRAME_BUCKET).list(TEST_IMG_PREFIX);
      if (cancelled) return;
      for (const side of ["front", "back"] as const) {
        const found = (list || []).find(f => f.name.startsWith(`${side}__`));
        if (!found) continue;
        const path = `${TEST_IMG_PREFIX}/${found.name}`;
        const { data: file } = await supabase.storage.from(FRAME_BUCKET).download(path);
        if (cancelled || !file) continue;
        const objUrl = URL.createObjectURL(file);
        const name = found.name.replace(/^(front|back)__/, "");
        setTestImages(prev => {
          revokeTestAsset(prev[side]);
          return { ...prev, [side]: { url: objUrl, name, path, objectUrl: true } };
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load test twincode SVG from storage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: list } = await supabase.storage.from(FRAME_BUCKET).list(TEST_TWINCODE_PREFIX);
      if (cancelled) return;
      const found = (list || []).find(f => f.name.startsWith("twincode__"));
      if (!found) return;
      const path = `${TEST_TWINCODE_PREFIX}/${found.name}`;
      const { data: pub } = supabase.storage.from(FRAME_BUCKET).getPublicUrl(path);
      const name = found.name.replace(/^twincode__/, "");
      setTestTwincodeSvg({ url: `${pub.publicUrl}?v=${Date.now()}`, name });
    })();
    return () => { cancelled = true; };
  }, []);

  const onUploadTestImage = async (side: "front" | "back", file: File | null) => {
    const { data: existing } = await supabase.storage.from(FRAME_BUCKET).list(TEST_IMG_PREFIX);
    const toRemove = (existing || [])
      .filter(f => f.name.startsWith(`${side}__`))
      .map(f => `${TEST_IMG_PREFIX}/${f.name}`);
    if (toRemove.length) await supabase.storage.from(FRAME_BUCKET).remove(toRemove);
    if (!file) {
      setTestImages(prev => {
        revokeTestAsset(prev[side]);
        return { ...prev, [side]: null };
      });
      toast({ title: `${side === "front" ? "앞면" : "뒷면"} 테스트 이미지 삭제됨`, description: "원래 카드 디자인이 적용됩니다" });
      return;
    }
    try {
      let uploadFile: Blob = file;
      let uploadName = file.name;
      let contentType = file.type || "image/png";
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (isPdf) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { dataUrl } = await renderPdfFirstPagePng(bytes);
        const bin = atob(dataUrl.split(",")[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        uploadFile = new Blob([arr], { type: "image/png" });
        uploadName = file.name.replace(/\.pdf$/i, "") + ".png";
        contentType = "image/png";
      }
      const safe = uploadName.replace(/[^\w.\-]+/g, "_");
      const path = `${TEST_IMG_PREFIX}/${side}__${safe}`;
      const { error } = await supabase.storage.from(FRAME_BUCKET)
        .upload(path, uploadFile, { upsert: true, contentType });
      if (error) { toast({ title: "업로드 실패", description: error.message, variant: "destructive" }); return; }
      const objUrl = URL.createObjectURL(uploadFile);
      setTestImages(prev => {
        revokeTestAsset(prev[side]);
        return { ...prev, [side]: { url: objUrl, name: file.name, path, objectUrl: true } };
      });
      toast({ title: `${side === "front" ? "앞면" : "뒷면"} 테스트 이미지 등록됨`, description: isPdf ? "PDF 첫 페이지가 이미지로 변환되었습니다" : undefined });
    } catch (e: any) {
      toast({ title: "업로드 실패", description: e.message, variant: "destructive" });
    }
  };

  const onUploadTestTwincode = async (file: File | null) => {
    const { data: existing } = await supabase.storage.from(FRAME_BUCKET).list(TEST_TWINCODE_PREFIX);
    const toRemove = (existing || [])
      .filter(f => f.name.startsWith("twincode__"))
      .map(f => `${TEST_TWINCODE_PREFIX}/${f.name}`);
    if (toRemove.length) await supabase.storage.from(FRAME_BUCKET).remove(toRemove);
    if (!file) {
      setTestTwincodeSvg(null);
      toast({ title: "트윈코드 테스트 SVG 삭제됨", description: "원래 API 트윈코드가 적용됩니다" });
      return;
    }
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${TEST_TWINCODE_PREFIX}/twincode__${safe}`;
      const { error } = await supabase.storage.from(FRAME_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || "image/svg+xml" });
      if (error) { toast({ title: "업로드 실패", description: error.message, variant: "destructive" }); return; }
      const { data: pub } = supabase.storage.from(FRAME_BUCKET).getPublicUrl(path);
      setTestTwincodeSvg({ url: `${pub.publicUrl}?v=${Date.now()}`, name: file.name });
      toast({ title: "트윈코드 테스트 SVG 등록됨" });
    } catch (e: any) {
      toast({ title: "업로드 실패", description: e.message, variant: "destructive" });
    }
  };

  // Load saved layout from user_ui_settings (per-order, fallback to global default)
  useEffect(() => {
    if (!userId) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const keys = [`${SETTINGS_KEY_PREFIX}-${orderNo}`, GLOBAL_LAYOUT_KEY];
      for (const key of keys) {
        const { data } = await supabase
          .from("user_ui_settings")
          .select("setting_value")
          .eq("user_id", userId)
          .eq("setting_key", key)
          .maybeSingle();
        if (cancelled) return;
        const v = data?.setting_value as any;
        if (v) {
          if (v.layoutFront) setLayoutFront(prev => ({ ...prev, ...v.layoutFront }));
          if (v.layoutBack)  setLayoutBack(prev => ({ ...prev, ...v.layoutBack }));
          if (v.workOrder)   setWorkOrder(prev => ({ ...prev, ...v.workOrder, orderNo }));
          if (v.testValues)  setTestValues(prev => ({ ...prev, ...v.testValues }));
          if (v.backDefaults) setBackDefaults(prev => ({ ...prev, ...v.backDefaults }));
          if (v.masterFont && FONT_OPTIONS.some(f => f.id === v.masterFont)) setMasterFont(v.masterFont);
          if (typeof v.masterFontWeight === "number") setMasterFontWeight(v.masterFontWeight);
          break;
        }
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userId, orderNo]);

  const saveLayout = async () => {
    if (!userId) { toast({ title: "로그인 필요", variant: "destructive" }); return; }
    const payload = { layoutFront, layoutBack, workOrder, testValues, backDefaults, masterFont, masterFontWeight } as any;
    const rows = [
      { user_id: userId, setting_key: `${SETTINGS_KEY_PREFIX}-${orderNo}`, setting_value: payload },
      { user_id: userId, setting_key: GLOBAL_LAYOUT_KEY, setting_value: payload },
    ];
    const { error } = await supabase
      .from("user_ui_settings")
      .upsert(rows as any, { onConflict: "user_id,setting_key" });
    if (error) {
      toast({ title: "저장 실패", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "저장 완료", description: "옵션 위치/크기/테스트값이 서버에 저장되었습니다" });
  };

  // ====== Build single-card PDF (2 pages: front + back) ======
  // 미리보기와 PDF가 서로 다른 엔진(pdf-lib 텍스트/브라우저 DOM)을 쓰며 위치·폰트·SVG 해석이 달라졌기 때문에,
  // 다운로드도 미리보기와 같은 브라우저 캔버스 합성 결과를 PDF 한 페이지 이미지로 넣는다.
  const buildCardPdfBytes = async (card: CardData, opts?: { sides?: Array<"front" | "back"> }): Promise<Uint8Array> => {
    const out = await PDFDocument.create();

    const textFor = (key: OptionKey): string => {
      switch (key) {
        case "cpValue":   return card.cpValue ?? "";
        case "editionNo": return card.editionNo ?? "";
        case "issuedNo":  return `ISSUED No. ${card.issuedNo ?? ""}`;
        case "mintedOn":  return `Minted on ${card.mintedOn ?? ""}`;
        case "grade":     return card.grade ?? "";
        case "companyName":  return backDefaults.companyName ?? "";
        case "centerSlogan": return backDefaults.centerSlogan ?? "";
        case "nfcEnabled":   return backDefaults.nfcEnabled ?? "";
        case "issuedBy":     return backDefaults.issuedBy ?? "";
        default: return "";
      }
    };

    const drawSide = async (
      side: "front" | "back",
      layout: Record<OptionKey, OptionLayout>,
      keys: OptionKey[],
    ) => {
      const cardWmm = cardSize.width;
      const cardHmm = cardSize.height;
      const pxPerMm = 300 / 25.4;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(64, Math.round(cardWmm * pxPerMm));
      canvas.height = Math.max(64, Math.round(cardHmm * pxPerMm));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const designUrl = testImages[side]?.url || (side === "front" ? card.frontImageUrl : card.backImageUrl);
      if (designUrl) {
        try {
          const clipped = await composeMaskedCardCanvas(designUrl, null, canvas.width, canvas.height);
          ctx.drawImage(clipped, 0, 0, canvas.width, canvas.height);
        } catch (e) { console.warn("card design render failed", e); }
      }


      for (const key of keys) {
        const cfg = layout[key];
        if (!cfg?.enabled) continue;
        const xMm = cfg.centerX ? (cardWmm - cfg.w) / 2 : cfg.x;
        const yMm = cfg.centerY ? (cardHmm - cfg.h) / 2 : cfg.y;
        const x = xMm * pxPerMm;
        const y = yMm * pxPerMm;
        const w = cfg.w * pxPerMm;
        const h = cfg.h * pxPerMm;

        if (key === "twincode") {
          const twincodeUrl = testTwincodeSvg?.url || card.twincodeSvgUrl;
          if (twincodeUrl) {
            let fetched: { img: HTMLImageElement; revoke: () => void } | null = null;
            try {
              fetched = await loadFetchedImage(twincodeUrl);
              ctx.fillStyle = "#fff";
              ctx.fillRect(x, y, w, h);
              drawImageContain(ctx, fetched.img, x, y, w, h);
            } catch (e) { console.warn("twincode draw fail", e); }
            finally { fetched?.revoke(); }
          }
          continue;
        }

        if (key === "dmBarcode") {
          try {
            const pad = Math.max(0, cfg.padding ?? 0) * pxPerMm;
            const png = await dataMatrixPngBytes(`${card.uniqueNo}|${card.uid}|${card.editionNo}`, Math.max(160, Math.round(Math.max(w, h) * 2)));
            const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
            try {
              const img = await loadImage(url, null);
              ctx.fillStyle = "#fff";
              ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
              drawImageContain(ctx, img, x, y, w, h);
            } finally { URL.revokeObjectURL(url); }
          } catch (e) { console.warn("DM draw fail", e); }
          continue;
        }

        const txt = textFor(key);
        if (!txt) continue;
        const fontPx = Math.max(4, cfg.fontSize * pxPerMm);
        const weight = textWeightForOption(key, masterFontWeight);
        try { await (document as any).fonts?.load(`${weight} ${fontPx}px ${currentFont.css}`); } catch {}
        // 텍스트 박스는 글자 크기에 맞춰 너비/높이 자동 계산
        const autoWmm = measureTextWidthMm(txt, cfg.fontSize, currentFont.css, weight);
        const autoHmm = cfg.fontSize;
        const tXmm = cfg.centerX ? (cardWmm - autoWmm) / 2 : cfg.x;
        const tYmm = cfg.centerY ? (cardHmm - autoHmm) / 2 : cfg.y;
        drawCanvasTextElement(ctx, txt, tXmm * pxPerMm, tYmm * pxPerMm, autoWmm * pxPerMm, fontPx, currentFont.css, weight, alignForOption(key));
      }

      const png = await canvasToPngBytes(canvas);
      const emb = await out.embedPng(png);
      const pageWpt = cardSize.width * MM;
      const pageHpt = cardSize.height * MM;
      const page = out.addPage([pageWpt, pageHpt]);
      page.drawImage(emb, { x: 0, y: 0, width: pageWpt, height: pageHpt });
    };

    const sides = opts?.sides ?? ["front", "back"];
    if (sides.includes("front")) await drawSide("front", layoutFront, FRONT_KEYS);
    if (sides.includes("back")) await drawSide("back", layoutBack, BACK_KEYS);
    return await out.save();
  };

  const downloadOne = async (card: CardData) => {
    setBusy(true);
    try {
      const bytes = await buildCardPdfBytes(card);
      downloadBlob(bytes, `${card.uniqueNo}.pdf`);
    } catch (e: any) {
      toast({ title: "PDF 생성 실패", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const downloadAll = async () => {
    setBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Map<string, number>();
      for (const card of cards) {
        const bytes = await buildCardPdfBytes(card);
        const base = card.uniqueNo;
        const n = used.get(base) || 0;
        const fname = n === 0 ? `${base}.pdf` : `${base}(${n}).pdf`;
        used.set(base, n + 1);
        zip.file(fname, bytes);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${orderNo}_nfc-cards_${tsName()}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "ZIP 다운로드 완료", description: `${cards.length}개 카드` });
    } catch (e: any) {
      toast({ title: "ZIP 생성 실패", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title={`NFC 카드 공장 · ${orderNo}`} description="주문 상세 목록" />
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={onBack}>
              <ChevronLeft className="w-4 h-4 mr-1" /> 목록으로
            </Button>
            <div className="text-sm text-muted-foreground">
              작업번호 <span className="font-mono text-foreground">{orderNo}</span> · {cards.length}건
            </div>
          </CardContent>
        </Card>

        {/* Work order */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>작업지시서 설정</span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={saveLayout} disabled={!loaded}>
                  <Save className="w-4 h-4 mr-1" />서버에 저장
                </Button>
                <Button size="sm" variant="outline" onClick={() => printWorkOrder(workOrder)}>
                  <FileText className="w-4 h-4 mr-1" />작업지시서 출력
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TxtField label="발주업체명" v={workOrder.company} set={v => setWorkOrder(p => ({ ...p, company: v }))} />
            <TxtField label="작업번호" v={workOrder.orderNo} set={v => setWorkOrder(p => ({ ...p, orderNo: v }))} />
            <TxtField label="총수량" type="number" v={String(workOrder.quantity)} set={v => setWorkOrder(p => ({ ...p, quantity: Number(v) || 0 }))} />
            <TxtField label="발주일" type="date" v={workOrder.orderDate} set={v => setWorkOrder(p => ({ ...p, orderDate: v }))} />
            <TxtField label="납품일" type="date" v={workOrder.deliveryDate} set={v => setWorkOrder(p => ({ ...p, deliveryDate: v }))} />
            <TxtField label="받을사람" v={workOrder.recipient} set={v => setWorkOrder(p => ({ ...p, recipient: v }))} />
            <TxtField label="전화번호" v={workOrder.phone} set={v => setWorkOrder(p => ({ ...p, phone: v }))} />
            <div className="md:col-span-2">
              <TxtField label="주소" v={workOrder.address} set={v => setWorkOrder(p => ({ ...p, address: v }))} />
            </div>
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">발주특이사항</Label>
              <Textarea value={workOrder.notes} onChange={e => setWorkOrder(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </CardContent>
        </Card>

        {/* Test image upload (per side) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">테스트 카드 디자인 이미지 (서버 저장)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(["front", "back"] as const).map(side => (
              <div key={side} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-medium text-xs">{side === "front" ? "앞면" : "뒷면"} 테스트 이미지</Label>
                  {testImages[side] && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600">서버 저장됨</span>
                  )}
                </div>
                <div className="flex justify-center">
                  <TestDesignThumb cardSize={cardSize} imageUrl={testImages[side]?.url ?? null} />
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {testImages[side]?.name || "삭제 전까지 서버에 유지됩니다"}
                </div>
                <div className="flex gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 cursor-pointer text-xs px-3 py-2 border border-dashed rounded hover:bg-accent">
                    <Upload className="w-3 h-3" />
                    <span>{testImages[side] ? "변경" : "이미지 업로드"}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden"
                      onChange={e => { const f = e.target.files?.[0] || null; e.currentTarget.value = ""; if (f) onUploadTestImage(side, f); }} />
                  </label>
                  {testImages[side] && (
                    <Button size="sm" variant="destructive" className="text-xs"
                      onClick={() => { if (confirm("테스트 이미지를 삭제하고 원래 API 디자인을 사용할까요?")) onUploadTestImage(side, null); }}>
                      <X className="w-3 h-3 mr-1" />삭제
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Test twincode SVG upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">트윈코드 테스트 SVG (서버 저장)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-medium text-xs">트윈코드 SVG</Label>
                {testTwincodeSvg && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600">서버 저장됨</span>
                )}
              </div>
              <div className="w-full h-32 border rounded bg-muted/30 overflow-hidden flex items-center justify-center">
                {testTwincodeSvg?.url
                  ? <img src={testTwincodeSvg.url} alt="" className="w-full h-full object-contain bg-white" />
                  : <span className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="w-3 h-3" />테스트 SVG 없음 (API 트윈코드 사용)</span>}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {testTwincodeSvg?.name || "삭제 전까지 서버에 유지됩니다"}
              </div>
              <div className="flex gap-2">
                <label className="flex-1 flex items-center justify-center gap-2 cursor-pointer text-xs px-3 py-2 border border-dashed rounded hover:bg-accent">
                  <Upload className="w-3 h-3" />
                  <span>{testTwincodeSvg ? "변경" : "SVG 업로드"}</span>
                  <input type="file" accept="image/svg+xml" className="hidden"
                    onChange={e => { const f = e.target.files?.[0] || null; e.currentTarget.value = ""; if (f) onUploadTestTwincode(f); }} />
                </label>
                {testTwincodeSvg && (
                  <Button size="sm" variant="destructive" className="text-xs"
                    onClick={() => { if (confirm("테스트 SVG를 삭제하고 원래 API 트윈코드를 사용할까요?")) onUploadTestTwincode(null); }}>
                    <X className="w-3 h-3 mr-1" />삭제
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 마스터 글자꼴 설정 — 미리보기 + PDF에 자동 적용 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
              <span>마스터 글자꼴</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                상업적 사용 가능 고딕체 · 선택 시 카드 텍스트/숫자에 자동 적용 (미리보기 + PDF)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {FONT_OPTIONS.map(f => {
                const active = masterFont === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMasterFont(f.id)}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <div className="text-[11px] text-muted-foreground mb-1">{f.label}</div>
                    <div className="text-lg leading-tight" style={{ fontFamily: f.css, fontWeight: masterFontWeight }}>
                      가나다 ABC 123
                    </div>
                    <div className="text-xs mt-0.5 text-muted-foreground" style={{ fontFamily: f.css, fontWeight: masterFontWeight }}>
                      ISSUED No. 0001
                    </div>
                  </button>
                );
              })}
            </div>

            {/* BOLD 강도 (font-weight) */}
            <div className="flex items-center gap-3 flex-wrap pt-1">
              <div className="text-xs text-muted-foreground min-w-[80px]">BOLD 강도</div>
              <div className="flex flex-wrap gap-1.5">
                {FONT_WEIGHTS.map(w => {
                  const active = masterFontWeight === w.value;
                  return (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => setMasterFontWeight(w.value)}
                      className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${
                        active
                          ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                          : "border-border hover:bg-accent"
                      }`}
                      style={{ fontFamily: currentFont.css, fontWeight: w.value }}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-muted-foreground">
                PDF 출력 시 600 이상은 Bold, 미만은 Regular로 임베드됩니다.
              </div>
            </div>
          </CardContent>
        </Card>


        {/* Test values for preview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>미리보기 테스트 값</span>
              <span className="text-[11px] font-normal text-muted-foreground">PDF/표 데이터는 그대로, 디자이너 미리보기에만 적용</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <TxtField label="앞면 · CP값" v={testValues.cpValue} set={v => setTestValues(p => ({ ...p, cpValue: v }))} />
            <TxtField label="앞면 · EDITION No." v={testValues.editionNo} set={v => setTestValues(p => ({ ...p, editionNo: v }))} />
            <TxtField label="뒷면 · ISSUED No." v={testValues.issuedNo} set={v => setTestValues(p => ({ ...p, issuedNo: v }))} />
            <TxtField label="뒷면 · Minted on" v={testValues.mintedOn} set={v => setTestValues(p => ({ ...p, mintedOn: v }))} />
            <TxtField label="뒷면 · 등급" v={testValues.grade} set={v => setTestValues(p => ({ ...p, grade: v }))} />
          </CardContent>
        </Card>

        {/* 뒷면 기본 텍스트 (전체 카드 공통 적용 · API 외) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>카드 뒷면 기본 텍스트</span>
              <span className="text-[11px] font-normal text-muted-foreground">전체 카드에 공통으로 적용되는 고정 텍스트입니다</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TxtField label="회사명" v={backDefaults.companyName} set={v => setBackDefaults(p => ({ ...p, companyName: v }))} />
            <TxtField label="중앙슬로건" v={backDefaults.centerSlogan} set={v => setBackDefaults(p => ({ ...p, centerSlogan: v }))} />
            <TxtField label="NFC Enabled" v={backDefaults.nfcEnabled} set={v => setBackDefaults(p => ({ ...p, nfcEnabled: v }))} />
            <TxtField label="ISSUED BY" v={backDefaults.issuedBy} set={v => setBackDefaults(p => ({ ...p, issuedBy: v }))} />
          </CardContent>
        </Card>


        {/* Layout designer */}
        <Tabs defaultValue="front">
          <TabsList>
            <TabsTrigger value="front">카드 앞면</TabsTrigger>
            <TabsTrigger value="back">카드 뒷면</TabsTrigger>
          </TabsList>

          <TabsContent value="front" className="pt-3">
            <CardSideEditor
              side="front"
              cardSize={cardSize}
              bleedMm={bleedMm}
              fontCss={currentFont.css}
              fontWeight={masterFontWeight}
              testImageUrl={testImages.front?.url || null}
              cardPreview={applyTestValues(cards[0], testValues)}
              layout={layoutFront}
              setLayout={setLayoutFront}
              keys={FRONT_KEYS}
              onTestPdf={async () => {
                const sample = applyTestValues(cards[0], testValues);
                if (!sample) { toast({ title: "샘플 카드가 없습니다", variant: "destructive" }); return; }
                try {
                  const bytes = await buildCardPdfBytes(sample, { sides: ["front"] });
                  downloadBlob(bytes, `test_front_${tsName()}.pdf`);
                } catch (e: any) {
                  toast({ title: "테스트 PDF 생성 실패", description: e.message, variant: "destructive" });
                }
              }}
            />
          </TabsContent>
          <TabsContent value="back" className="pt-3">
            <CardSideEditor
              side="back"
              cardSize={cardSize}
              bleedMm={bleedMm}
              fontCss={currentFont.css}
              fontWeight={masterFontWeight}
              testImageUrl={testImages.back?.url || null}
              testTwincodeUrl={testTwincodeSvg?.url || null}
              cardPreview={applyTestValues(cards[0], testValues)}
              layout={layoutBack}
              setLayout={setLayoutBack}
              keys={BACK_KEYS}
              backDefaults={backDefaults}
              onTestPdf={async () => {
                const sample = applyTestValues(cards[0], testValues);
                if (!sample) { toast({ title: "샘플 카드가 없습니다", variant: "destructive" }); return; }
                try {
                  const bytes = await buildCardPdfBytes(sample, { sides: ["back"] });
                  downloadBlob(bytes, `test_back_${tsName()}.pdf`);
                } catch (e: any) {
                  toast({ title: "테스트 PDF 생성 실패", description: e.message, variant: "destructive" });
                }
              }}
            />

          </TabsContent>
        </Tabs>

        {/* Download bar */}
        <Card>
          <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-muted-foreground">
              파일명: <span className="font-mono">{orderNo}-4.pdf</span> · 중복시 (1),(2) 자동 부여
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={downloadAll} disabled={busy || cards.length === 0}>
                {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                전체 PDF (ZIP)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">순번</TableHead>
                  <TableHead>주문번호</TableHead>
                  <TableHead>UID</TableHead>
                  <TableHead>카드고유번호</TableHead>
                  <TableHead>앞면</TableHead>
                  <TableHead>뒷면</TableHead>
                  <TableHead>CP값</TableHead>
                  <TableHead>EDITION</TableHead>
                  <TableHead>ISSUED No.</TableHead>
                  <TableHead>Minted on</TableHead>
                  <TableHead>등급</TableHead>
                  <TableHead>ISSUED BY</TableHead>
                  <TableHead>트윈코드</TableHead>
                  <TableHead>DM 바코드</TableHead>
                  <TableHead className="text-right">다운로드</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.length === 0 && (
                  <TableRow><TableCell colSpan={15} className="text-center py-8 text-muted-foreground">—</TableCell></TableRow>
                )}
                {cards.map(c => (
                  <TableRow key={`${c.uniqueNo}-${c.seq}`}>
                    <TableCell className="tabular-nums">{c.seq}</TableCell>
                    <TableCell className="font-mono text-xs">{c.orderNo}</TableCell>
                    <TableCell className="font-mono text-xs">{c.uid}</TableCell>
                    <TableCell className="font-mono text-xs">{c.uniqueNo}</TableCell>
                    <TableCell>
                      {c.frontImageUrl
                        ? <a href={c.frontImageUrl} target="_blank" rel="noopener noreferrer"><CardFrame widthClassName="w-8" className="border rounded"><img src={c.frontImageUrl} alt="" className="w-full h-full object-cover" /></CardFrame></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      {c.backImageUrl
                        ? <a href={c.backImageUrl} target="_blank" rel="noopener noreferrer"><CardFrame widthClassName="w-8" className="border rounded"><img src={c.backImageUrl} alt="" className="w-full h-full object-cover" /></CardFrame></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="text-xs">{c.cpValue || "-"}</TableCell>
                    <TableCell className="text-xs">{c.editionNo}</TableCell>
                    <TableCell className="text-xs">{c.issuedNo}</TableCell>
                    <TableCell className="text-xs">{c.mintedOn}</TableCell>
                    <TableCell><Badge variant="outline">{c.grade}</Badge></TableCell>
                    <TableCell>
                      {c.issuedByUrl
                        ? <a href={c.issuedByUrl} target="_blank" rel="noopener noreferrer"><img src={c.issuedByUrl} alt="" className="w-10 h-6 object-contain border rounded bg-white" /></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      {c.twincodeSvgUrl
                        ? <a href={c.twincodeSvgUrl} target="_blank" rel="noopener noreferrer"><img src={c.twincodeSvgUrl} alt="" className="w-8 h-8 object-contain border rounded bg-white" /></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell><DmThumb text={`${c.uniqueNo}|${c.uid}|${c.editionNo}`} /></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => downloadOne(c)} disabled={busy}>
                        <Download className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Apply test value overrides to the preview card (for designer preview only)
function applyTestValues(c: CardData | undefined, tv: { cpValue: string; editionNo: string; issuedNo: string; mintedOn: string; grade: string }): CardData | undefined {
  if (!c) return c;
  return {
    ...c,
    cpValue:   tv.cpValue   ? tv.cpValue   : c.cpValue,
    editionNo: tv.editionNo ? tv.editionNo : c.editionNo,
    issuedNo:  tv.issuedNo  ? tv.issuedNo  : c.issuedNo,
    mintedOn:  tv.mintedOn  ? tv.mintedOn  : c.mintedOn,
    grade:     tv.grade     ? tv.grade     : c.grade,
  };
}

// ============== Card side editor (preview + per-option controls) ==============
function CardSideEditor({
  side, cardSize, testImageUrl, testTwincodeUrl, cardPreview, layout, setLayout, keys, backDefaults, onTestPdf,
  bleedMm, fontCss, fontWeight,
}: {
  side: "front" | "back";
  cardSize: CardSize;
  testImageUrl?: string | null;
  testTwincodeUrl?: string | null;
  cardPreview?: CardData;
  layout: Record<OptionKey, OptionLayout>;
  setLayout: React.Dispatch<React.SetStateAction<Record<OptionKey, OptionLayout>>>;
  keys: OptionKey[];
  backDefaults?: { companyName: string; centerSlogan: string; nfcEnabled: string; issuedBy: string };
  onTestPdf?: () => void | Promise<void>;
  bleedMm: number;
  fontCss?: string;
  fontWeight?: number;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 카드 크기는 저장된 사이즈 설정을 따른다 (기본 57×87mm).
  const cardWmm = cardSize.width;
  const cardHmm = cardSize.height;
  const PX_PER_MM_REAL = 96 / 25.4;
  const PREVIEW_SCALE = 2;
  const pxPerMm = PX_PER_MM_REAL * PREVIEW_SCALE;
  const previewW = cardWmm * pxPerMm;
  const previewH = cardHmm * pxPerMm;


  const [selected, setSelected] = useState<OptionKey | null>(keys[0] ?? null);
  const stageRef = useRef<HTMLDivElement | null>(null);


  const update = (key: OptionKey, patch: Partial<OptionLayout>) => {
    setLayout(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const clampMm = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v * 10) / 10));

  // Drag move / resize using pointer events
  const startDrag = (
    e: React.PointerEvent,
    key: OptionKey,
    mode: "move" | "resize",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(key);
    
    const startX = e.clientX;
    const startY = e.clientY;
    const cfg = layout[key];
    const startMm = { x: cfg.x, y: cfg.y, w: cfg.w, h: cfg.h };
    const isImage = key === "twincode" || key === "dmBarcode";
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dxMm = (ev.clientX - startX) / pxPerMm;
      const dyMm = (ev.clientY - startY) / pxPerMm;
      if (mode === "move") {
        // 텍스트(autoSize)는 컨테이너 너비/높이가 가변이므로 카드 전체 범위로 클램프
        const maxX = isImage ? cardWmm - cfg.w : cardWmm;
        const maxY = isImage ? cardHmm - cfg.h : cardHmm;
        update(key, {
          x: clampMm(startMm.x + dxMm, maxX),
          y: clampMm(startMm.y + dyMm, maxY),
          centerX: false,
          centerY: false,
        });
      } else {
        if (key === "dmBarcode") {
          // square: keep w == h
          const size = clampMm(startMm.w + Math.max(dxMm, dyMm), Math.min(cardWmm - cfg.x, cardHmm - cfg.y));
          update(key, { w: size, h: size });
        } else {
          update(key, {
            w: clampMm(startMm.w + dxMm, cardWmm - cfg.x),
            h: clampMm(startMm.h + dyMm, cardHmm - cfg.y),
          });
        }
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };




  const [dmPreview, setDmPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!keys.includes("dmBarcode") || !cardPreview) return;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await dataMatrixPngBytes(`${cardPreview.uniqueNo}|${cardPreview.uid}|${cardPreview.editionNo}`, 200);
        if (cancelled) return;
        const blob = new Blob([bytes as BlobPart], { type: "image/png" });
        setDmPreview(URL.createObjectURL(blob));
      } catch {}
    })();
    return () => { cancelled = true; if (dmPreview) URL.revokeObjectURL(dmPreview); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPreview?.uniqueNo, keys.join(",")]);

  const designUrl = testImageUrl || (side === "front" ? cardPreview?.frontImageUrl : cardPreview?.backImageUrl) || null;
  const [clippedPreview, setClippedPreview] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!designUrl) { setClippedPreview(null); return; }
    (async () => {
      try {
        const canvas = await composeMaskedCardCanvas(designUrl, null, previewW, previewH);
        if (!cancelled) setClippedPreview(canvas.toDataURL("image/png"));
      } catch {
        if (!cancelled) setClippedPreview(designUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [designUrl, previewW, previewH]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(previewW * ratio));
    const height = Math.max(1, Math.round(previewH * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = `${previewW}px`;
    canvas.style.height = `${previewH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, previewW, previewH);
    if (!cardPreview) return;

    const textFor = (key: OptionKey): string => {
      switch (key) {
        case "cpValue":   return cardPreview.cpValue || "-";
        case "editionNo": return cardPreview.editionNo || "";
        case "issuedNo":  return `ISSUED No. ${cardPreview.issuedNo || ""}`;
        case "mintedOn":  return `Minted on ${cardPreview.mintedOn || ""}`;
        case "grade":     return cardPreview.grade || "";
        case "companyName":  return backDefaults?.companyName || "";
        case "centerSlogan": return backDefaults?.centerSlogan || "";
        case "nfcEnabled":   return backDefaults?.nfcEnabled || "";
        case "issuedBy":     return backDefaults?.issuedBy || "";
        default: return "";
      }
    };

    (async () => {
      const drawableKeys = keys.filter(key => {
        const cfg = layout[key];
        return !!cfg?.enabled && key !== "twincode" && key !== "dmBarcode" && !!textFor(key);
      });
      await Promise.all(drawableKeys.map(key => {
        const cfg = layout[key];
        const fontPx = Math.max(4, (cfg.fontSize || 3) * pxPerMm);
        const weight = textWeightForOption(key, fontWeight ?? 500);
        return (document as any).fonts?.load(`${weight} ${fontPx}px ${fontCss || "'Inter', system-ui, sans-serif"}`);
      }));
      if (cancelled) return;
      ctx.clearRect(0, 0, previewW, previewH);
      drawableKeys.forEach(key => {
        const cfg = layout[key];
        const txt = textFor(key);
        const weight = textWeightForOption(key, fontWeight ?? 500);
        const family = fontCss || "'Inter', system-ui, sans-serif";
        const autoWmm = measureTextWidthMm(txt, cfg.fontSize || 3, family, weight);
        const autoHmm = cfg.fontSize || 3;
        const xMm = cfg.centerX ? (cardWmm - autoWmm) / 2 : cfg.x;
        const yMm = cfg.centerY ? (cardHmm - autoHmm) / 2 : cfg.y;
        const fontPx = Math.max(4, (cfg.fontSize || 3) * pxPerMm);
        drawCanvasTextElement(ctx, txt, xMm * pxPerMm, yMm * pxPerMm, autoWmm * pxPerMm, fontPx, family, weight, alignForOption(key));
      });
    })();
    return () => { cancelled = true; };
  }, [backDefaults, cardHmm, cardPreview, cardWmm, fontCss, fontWeight, keys, layout, previewH, previewW, pxPerMm]);

  // 글자 크기 변경 시 어느 쪽을 기준으로 자라거나 줄어들지 결정하는 앵커
  const getAnchorX = (key: OptionKey): "left" | "center" | "right" => {
    switch (key) {
      case "cpValue":
      case "grade":
      case "centerSlogan": return "center";
      case "editionNo":
      case "mintedOn":
      case "nfcEnabled":   return "right";
      case "issuedNo":
      case "companyName":
      case "issuedBy":     return "left";
      default:             return "left";
    }
  };

  const renderOptionPreview = (key: OptionKey) => {
    if (!cardPreview) return null;
    switch (key) {
      case "cpValue":
      case "editionNo":
      case "issuedNo":
      case "mintedOn":
      case "grade":
      case "companyName":
      case "centerSlogan":
      case "nfcEnabled":
      case "issuedBy":  return null;
      case "twincode":  {
        const tcUrl = testTwincodeUrl || cardPreview.twincodeSvgUrl;
        return tcUrl
          ? <img src={tcUrl} alt="" className="w-full h-full object-contain bg-white pointer-events-none" />
          : <span className="text-[8px] text-muted-foreground">TWIN</span>;
      }
      case "dmBarcode": return dmPreview
        ? <img src={dmPreview} alt="" className="w-full h-full object-contain pointer-events-none bg-white" />
        : <span className="text-[8px] text-muted-foreground">DM</span>;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>{side === "front" ? "카드 앞면" : "카드 뒷면"} 옵션 배치</span>
          <div className="flex items-center gap-3 text-xs font-normal">
            <span className="text-muted-foreground">실제 인쇄 크기 ({cardWmm.toFixed(1)}×{cardHmm.toFixed(1)}mm) · 저장된 카드 사이즈</span>
            {onTestPdf && (
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={pdfBusy}
                onClick={async () => {
                  setPdfBusy(true);
                  try { await onTestPdf(); } finally { setPdfBusy(false); }
                }}
              >
                {pdfBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                테스트 PDF
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          박스를 드래그해 이동하거나 오른쪽 아래 모서리를 끌어 크기를 조절하세요.
        </div>

        {/* Preview */}
        <div className="flex justify-center overflow-auto">
          <CardFrame
            ref={stageRef}
            className="border-2 rounded-md shadow-md"
            style={{
              width: previewW,
              aspectRatio: `${cardWmm} / ${cardHmm}`,
              background: "#fff",
              fontFamily: fontCss || "'Inter', system-ui, sans-serif",
              fontWeight: fontWeight ?? 500,
            }}
          >

            {/* 열전사 디자인 공장과 동일하게 PDF를 마스크 캔버스로 변환해 디자인을 먼저 합성합니다. */}
            {clippedPreview && (
              <img
                src={clippedPreview}
                alt=""
                className="absolute inset-0 w-full h-full object-fill pointer-events-none"
              />
            )}
            {!clippedPreview && (
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground pointer-events-none">
                테스트 이미지 또는 API 디자인이 없습니다
              </div>
            )}
            <canvas
              ref={previewCanvasRef}
              className="absolute inset-0 pointer-events-none"
              aria-hidden
            />

            {keys.map(key => {
              const cfg = layout[key];
              if (!cfg?.enabled) return null;
              const fontPx = (cfg.fontSize || 3) * pxPerMm;
              const isImage = key === "twincode" || key === "dmBarcode";
              const isSel = selected === key;
              // PDF와 동일한 박스 기반 좌표/정렬 — 텍스트도 cfg.w 폭의 박스 안에서 정렬
              const xMm = cfg.centerX ? (cardWmm - cfg.w) / 2 : cfg.x;
              const yMm = cfg.centerY ? (cardHmm - cfg.h) / 2 : cfg.y;
              const boxWpx = cfg.w * pxPerMm;
              const boxHpx = isImage ? cfg.h * pxPerMm : Math.max(fontPx, 4);
              return (
                <div
                  key={key}
                  onPointerDown={e => startDrag(e, key, "move")}
                  className={`absolute flex items-start justify-center text-foreground overflow-visible select-none ${
                    isSel ? "border-2 border-primary bg-primary/10 ring-2 ring-primary/30" : "border border-primary/60 bg-primary/5 hover:bg-primary/10"
                  }`}
                  style={{
                    left: xMm * pxPerMm,
                    top: yMm * pxPerMm,
                    width: boxWpx,
                    height: boxHpx,
                    fontSize: isImage ? undefined : fontPx,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    cursor: "move",
                    background: key === "dmBarcode" ? "#fff" : undefined,
                    boxShadow: key === "dmBarcode" ? `0 0 0 ${(cfg.padding ?? 0) * pxPerMm}px #fff` : undefined,
                  }}
                  title={`${OPTION_LABELS[key]} — 드래그로 이동`}
                >
                  {renderOptionPreview(key)}
                  {/* label tag */}
                  <span className="absolute -top-4 left-0 text-[10px] bg-primary text-primary-foreground px-1 rounded-sm whitespace-nowrap pointer-events-none">
                    {OPTION_LABELS[key]}
                  </span>
                  {/* resize handle */}
                  <span
                    onPointerDown={e => startDrag(e, key, "resize")}
                    className="absolute right-0 bottom-0 w-3 h-3 bg-primary cursor-se-resize"
                    title="크기 조절"
                  />
                </div>
              );
            })}
          </CardFrame>
        </div>

        {/* Per-option controls */}
        <div className="space-y-2">
          {keys.map(key => {
            const cfg = layout[key];
            const isImage = key === "twincode" || key === "dmBarcode";
            const isSel = selected === key;
            return (
              <div
                key={key}
                onClick={() => setSelected(key)}
                className={`border rounded-md p-3 grid grid-cols-2 md:grid-cols-9 gap-2 items-end cursor-pointer ${isSel ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="md:col-span-2 flex items-center gap-2">
                  <Checkbox checked={cfg.enabled} onCheckedChange={v => update(key, { enabled: !!v })} />
                  <Label className="text-sm font-medium">{OPTION_LABELS[key]}</Label>
                </div>
                <Mini label="X(mm)" v={cfg.x} set={v => update(key, { x: v })} disabled={cfg.centerX} />
                <Mini label="Y(mm)" v={cfg.y} set={v => update(key, { y: v })} disabled={cfg.centerY} />
                {key === "dmBarcode" ? (
                  <>
                    <Mini label="크기(mm)" v={cfg.w} set={v => update(key, { w: v, h: v })} />
                    <Mini label="여백(mm)" v={cfg.padding ?? 0} set={v => update(key, { padding: Math.max(0, v) })} step={0.1} />
                  </>
                ) : (
                  <>
                    <Mini label="너비(mm)" v={cfg.w} set={v => update(key, { w: v })} />
                    <Mini label={isImage ? "높이(mm)" : "박스높이(mm)"} v={cfg.h} set={v => update(key, { h: v })} />
                  </>
                )}
                {!isImage && (
                  <Mini label="글자(mm)" v={cfg.fontSize} set={v => update(key, { fontSize: v })} step={0.1} />
                )}
                <div className="flex items-center gap-1">
                  <Checkbox checked={cfg.centerX} onCheckedChange={v => update(key, { centerX: !!v })} />
                  <Label className="text-xs">가로 중앙</Label>
                </div>
                <div className="flex items-center gap-1">
                  <Checkbox checked={cfg.centerY} onCheckedChange={v => update(key, { centerY: !!v })} />
                  <Label className="text-xs">세로 중앙</Label>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TestDesignThumb({ cardSize, imageUrl }: { cardSize: CardSize; imageUrl: string | null }) {
  const cardWmm = cardSize.width;
  const cardHmm = cardSize.height;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!imageUrl) { setSrc(null); return; }
    (async () => {
      try {
        const canvas = await composeMaskedCardCanvas(imageUrl, null, 240, 240 * (cardHmm / cardWmm));
        if (!cancelled) setSrc(canvas.toDataURL("image/png"));
      } catch {
        if (!cancelled) setSrc(imageUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [imageUrl, cardWmm, cardHmm]);

  return (
    <CardFrame
      widthClassName="w-28"
      className="border rounded bg-muted/30 flex items-center justify-center"
      style={{ aspectRatio: `${cardWmm} / ${cardHmm}` }}
    >
      {src
        ? <img src={src} alt="" className="w-full h-full object-fill bg-white" />
        : <span className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="w-3 h-3" />테스트 이미지 없음 (API 디자인 사용)</span>}
    </CardFrame>
  );
}

function Mini({ label, v, set, step, disabled }: { label: string; v: number; set: (v: number) => void; step?: number; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input type="number" step={step ?? 0.5} value={v} disabled={disabled}
        onChange={e => set(Number(e.target.value) || 0)} className="h-8 text-xs" />
    </div>
  );
}

function TxtField({ label, v, set, type = "text" }: { label: string; v: string; set: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={v} onChange={e => set(e.target.value)} className="h-9" />
    </div>
  );
}

function DmThumb({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bytes = await dataMatrixPngBytes(text, 120);
        if (cancelled) return;
        const blob = new Blob([bytes as BlobPart], { type: "image/png" });
        setSrc(URL.createObjectURL(blob));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [text]);
  return src
    ? <img src={src} alt="dm" className="w-8 h-8 border rounded bg-white" />
    : <div className="w-8 h-8 border rounded bg-muted" />;
}

// ===== Work order print (Chinese) =====
function printWorkOrder(wo: { company: string; orderNo: string; orderDate: string; deliveryDate: string; quantity: number; recipient: string; phone: string; address: string; notes: string; }) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>作业指示书 - ${esc(wo.orderNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif; color:#111; margin:0; }
  h1 { font-size: 22pt; text-align:center; margin: 0 0 4mm; letter-spacing: 8px; border-bottom: 2px solid #111; padding-bottom: 4mm; }
  .meta { display:flex; justify-content:space-between; font-size: 9pt; color:#555; margin-bottom: 6mm; }
  table { width:100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 1px solid #333; padding: 2.5mm 3mm; vertical-align: middle; }
  th { background:#f2f2f2; font-weight:600; width: 22%; text-align:left; }
  .notes { min-height: 22mm; white-space: pre-wrap; }
  h2 { font-size: 12pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  .no-print { position:fixed; top:8px; right:8px; }
  @media print { .no-print { display:none; } }
</style></head>
<body>
  <div class="no-print"><button onclick="window.print()">打印 / 保存PDF</button></div>
  <h1>NFC 卡 · 作 业 指 示 书</h1>
  <div class="meta"><span>发包方:${esc(wo.company)}</span><span>打印日期:${today}</span></div>
  <table>
    <tr><th>发包公司</th><td>${esc(wo.company)}</td><th>作业编号</th><td>${esc(wo.orderNo)}</td></tr>
    <tr><th>下单日期</th><td>${esc(wo.orderDate)}</td><th>交货日期</th><td>${esc(wo.deliveryDate)}</td></tr>
    <tr><th>总数量</th><td>${esc(wo.quantity)}</td><th>收件人</th><td>${esc(wo.recipient)}</td></tr>
    <tr><th>联系电话</th><td>${esc(wo.phone)}</td><th>收货地址</th><td>${esc(wo.address)}</td></tr>
  </table>
  <h2>订单特殊事项</h2>
  <table><tr><td class="notes">${esc(wo.notes) || "&nbsp;"}</td></tr></table>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body></html>`;
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", variant: "destructive" }); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
