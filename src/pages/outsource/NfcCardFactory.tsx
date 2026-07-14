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
import { Switch } from "@/components/ui/switch";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, Download, Eye, FileText, Loader2, Upload, X, ChevronLeft, Save, Image as ImageIcon, ZoomIn, ZoomOut, Maximize2, Cloud, CheckCircle2, Package } from "lucide-react";
import { VECTORIZER_MODE_KEY } from "./OutsourceSettings";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import bwipjs from "bwip-js/browser";
import { CardFrame, CARD_W_MM, CARD_H_MM } from "@/components/outsource/CardFrame";
import { cn } from "@/lib/utils";
import { ensureSpoqaFontFace, loadSpoqaFontBytes, waitForSpoqaLoaded } from "@/lib/pdf-fonts";
import { svgStringToPdfBytes, fetchSvgString, svgAspectRatio } from "@/lib/svg-to-pdf";
import { loadOpentypeFont, measureOutlineWidthPt, outlineAscentPt, drawTextAsOutline } from "@/lib/text-outline";

const MM = 2.8346456693; // 1mm in pt
// 프레임/PDF 원본 크기 그대로 사용 — 별도 여백 보정 없음.
const DEFAULT_FRAME_BLEED_MM = 0;
const FRAME_BUCKET = "design-formats";
const TEST_IMG_PREFIX = "nfc-card-test";
const TEST_BACK_IMG_PREFIX = "nfc-card-test-back-grade";
const SETTINGS_KEY_PREFIX = "outsource-nfc-card-v1";
const GLOBAL_LAYOUT_KEY = "outsource-nfc-card-layout-default";
const CARD_SIZE_KEY = "outsource-nfc-card-size";
const TEST_TWINCODE_PREFIX = "nfc-card-test";
const TEST_SIGNATURE_PREFIX = "nfc-card-test";

interface CardSize { width: number; height: number }
const DEFAULT_CARD_SIZE: CardSize = { width: CARD_W_MM, height: CARD_H_MM };

type UploadDebugInfo = {
  title: string;
  bucket: string;
  objectPath: string;
  requestPath: string;
  operation: string;
  httpStatus: string;
  storageStatusCode: string;
  errorMessage: string;
  errorName: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  contentType: string;
  upsert: string;
  authState: string;
  userId: string;
  policyTarget: string;
  policyHint: string;
  likelyCause: string;
  checkedAt: string;
};

function formatFileSize(bytes?: number) {
  if (!Number.isFinite(bytes)) return "unknown";
  if ((bytes ?? 0) < 1024) return `${bytes} B`;
  if ((bytes ?? 0) < 1024 * 1024) return `${((bytes ?? 0) / 1024).toFixed(1)} KB`;
  return `${((bytes ?? 0) / 1024 / 1024).toFixed(2)} MB`;
}

function normalizeCpValue(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^CP\s*/i.test(s)) return s;
  return `CP ${s}`;
}

function buildUploadDebugInfo(params: {
  title: string;
  objectPath: string;
  operation: string;
  error: unknown;
  file?: File | Blob | null;
  fileName?: string;
  contentType?: string;
  userId?: string;
}): UploadDebugInfo {
  const error = (params.error && typeof params.error === "object") ? params.error as Record<string, unknown> : {};
  const statusCode = String(error.statusCode || error.status || "unknown");
  const message = String(error.message || (params.error instanceof Error ? params.error.message : "알 수 없는 업로드 오류"));
  const isRls = /row-level security|rls|unauthorized|403/i.test(`${statusCode} ${message}`);

  return {
    title: params.title,
    bucket: FRAME_BUCKET,
    objectPath: params.objectPath,
    requestPath: `/storage/v1/object/${FRAME_BUCKET}/${params.objectPath}`,
    operation: params.operation,
    httpStatus: statusCode === "unknown" ? "Storage API 응답 코드 확인 불가" : statusCode,
    storageStatusCode: String(error.statusCode || "unknown"),
    errorMessage: message,
    errorName: String(error.name || error.error || (params.error instanceof Error ? params.error.name : "StorageError")),
    fileName: params.fileName || (params.file instanceof File ? params.file.name : "변환된 업로드 파일"),
    fileType: params.file instanceof File ? (params.file.type || "unknown") : "Blob",
    fileSize: formatFileSize(params.file?.size),
    contentType: params.contentType || "unknown",
    upsert: "true",
    authState: params.userId ? "로그인 사용자 토큰으로 요청" : "사용자 ID 없음 / 로그인 필요",
    userId: params.userId || "없음",
    policyTarget: `storage.objects 정책 + bucket_id='${FRAME_BUCKET}'`,
    policyHint: "INSERT/UPDATE/DELETE 정책의 WITH CHECK 또는 USING 조건이 업로드 요청의 bucket_id/name/auth.uid()와 맞아야 합니다.",
    likelyCause: isRls
      ? "저장소 RLS 정책이 이 요청을 허용하지 않았습니다. bucket_id, object path, auth.uid(), 정책 조건을 확인해야 합니다."
      : "Storage API 또는 파일 처리 단계에서 실패했습니다. 아래 요청 정보와 오류 메시지를 확인하세요.",
    checkedAt: new Date().toLocaleString(),
  };
}

async function uploadNfcCardAsset(path: string, file: Blob, contentType: string) {
  const form = new FormData();
  form.append("path", path);
  form.append("contentType", contentType);
  form.append("file", file);

  const { data, error } = await supabase.functions.invoke("nfc-card-upload", {
    body: form,
  });
  if (error) throw error;
  if (!data?.publicUrl) throw new Error("업로드 응답에 publicUrl이 없습니다");
  return data as { bucket: string; path: string; publicUrl: string };
}

function UploadDebugPanel({ info, onClose }: { info: UploadDebugInfo; onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["버킷", info.bucket],
    ["오브젝트 경로", info.objectPath],
    ["요청 경로", info.requestPath],
    ["작업", info.operation],
    ["HTTP/Storage 상태", `${info.httpStatus} / ${info.storageStatusCode}`],
    ["오류명", info.errorName],
    ["오류 메시지", info.errorMessage],
    ["파일", `${info.fileName} · ${info.fileType} · ${info.fileSize}`],
    ["Content-Type", info.contentType],
    ["Upsert", info.upsert],
    ["인증", info.authState],
    ["사용자 ID", info.userId],
    ["정책 대상", info.policyTarget],
    ["정책 힌트", info.policyHint],
    ["추정 원인", info.likelyCause],
    ["확인 시각", info.checkedAt],
  ];

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" /> {info.title}
          </span>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 px-2">
            <X className="w-3 h-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border bg-background/60 overflow-hidden">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-1 md:grid-cols-[150px_1fr] border-b last:border-b-0">
              <div className="px-3 py-2 text-xs font-medium bg-muted/50">{label}</div>
              <div className="px-3 py-2 text-xs font-mono break-all whitespace-pre-wrap">{value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Master font options (상업적 사용 가능 / commercial-free Korean gothic) =====
interface FontOption {
  id: string;
  label: string;
  css: string;        // CSS font-family stack (preview)
  cssLink: string;    // <link rel=stylesheet> href to register family in browser
  /** Returns a TTF/OTF/WOFF URL for the given weight. Used to embed the same font in PDF outlines. */
  pdfFontUrl?: (weight: number) => string;
}
// Pretendard exposes per-weight TTFs on jsDelivr (orioncactus/pretendard repo)
const pretendardWeightName = (w: number): string => {
  if (w >= 850) return "Black";
  if (w >= 750) return "ExtraBold";
  if (w >= 650) return "Bold";
  if (w >= 550) return "SemiBold";
  if (w >= 450) return "Medium";
  if (w >= 350) return "Regular";
  if (w >= 250) return "Light";
  if (w >= 150) return "ExtraLight";
  return "Thin";
};
const FONT_OPTIONS: FontOption[] = [
  {
    id: "pretendard",
    label: "Pretendard",
    css: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
    cssLink: "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/public/static/Pretendard-${pretendardWeightName(w)}.otf`,
  },
  {
    id: "ibm-plex-sans-kr",
    label: "IBM Plex Sans KR",
    css: "'IBM Plex Sans KR', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;700&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-kr/files/ibm-plex-sans-kr-korean-${w >= 650 ? 700 : 400}-normal.woff`,
  },
  {
    id: "spoqa-han-sans-neo",
    label: "Spoqa Han Sans Neo",
    css: "'Spoqa Han Sans Neo', sans-serif",
    cssLink: "", // bundled locally via ensureSpoqaFontFace()
  },
  {
    id: "black-han-sans",
    label: "Black Han Sans (블랙한산스 · Bold)",
    css: "'Black Han Sans', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap",
    pdfFontUrl: () => `https://cdn.jsdelivr.net/npm/@fontsource/black-han-sans/files/black-han-sans-korean-400-normal.woff`,
  },
  {
    id: "do-hyeon",
    label: "Do Hyeon (도현체 · Bold)",
    css: "'Do Hyeon', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Do+Hyeon&display=swap",
    pdfFontUrl: () => `https://cdn.jsdelivr.net/npm/@fontsource/do-hyeon/files/do-hyeon-korean-400-normal.woff`,
  },
  // ===== English commercial-free fonts (Google Fonts / SIL OFL · Apache 2.0) =====
  {
    id: "inter",
    label: "Inter (EN · Modern Sans)",
    css: "'Inter', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-${[300,400,500,600,700,800,900].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "roboto",
    label: "Roboto (EN · Neutral Sans)",
    css: "'Roboto', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700;900&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/roboto-latin-${[300,400,500,700,900].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "montserrat",
    label: "Montserrat (EN · Geometric Sans)",
    css: "'Montserrat', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/montserrat/files/montserrat-latin-${[300,400,500,600,700,800,900].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "poppins",
    label: "Poppins (EN · Rounded Sans)",
    css: "'Poppins', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/poppins/files/poppins-latin-${[300,400,500,600,700,800,900].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "oswald",
    label: "Oswald (EN · Condensed)",
    css: "'Oswald', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/oswald/files/oswald-latin-${[300,400,500,600,700].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "bebas-neue",
    label: "Bebas Neue (EN · Display Caps)",
    css: "'Bebas Neue', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap",
    pdfFontUrl: () => `https://cdn.jsdelivr.net/npm/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff`,
  },
  {
    id: "playfair-display",
    label: "Playfair Display (EN · Elegant Serif)",
    css: "'Playfair Display', serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800;900&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/playfair-display/files/playfair-display-latin-${[400,500,600,700,800,900].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "space-grotesk",
    label: "Space Grotesk (EN · Tech Sans)",
    css: "'Space Grotesk', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk/files/space-grotesk-latin-${[300,400,500,600,700].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "dm-sans",
    label: "DM Sans (EN · Clean Sans)",
    css: "'DM Sans', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/dm-sans/files/dm-sans-latin-${[400,500,700].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "archivo",
    label: "Archivo (EN · Grotesque Sans)",
    css: "'Archivo', sans-serif",
    cssLink: "https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;500;600;700;800;900&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/archivo/files/archivo-latin-${[300,400,500,600,700,800,900].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono (EN · Monospace)",
    css: "'JetBrains Mono', monospace",
    cssLink: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap",
    pdfFontUrl: (w) => `https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${[300,400,500,600,700,800].reduce((p,c)=>Math.abs(c-w)<Math.abs(p-w)?c:p,400)}-normal.woff`,
  },
];
const DEFAULT_MASTER_FONT = "spoqa-han-sans-neo";
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

function drawImageContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }, x: number, y: number, w: number, h: number, anchor: AnchorPoint = "mc") {
  const iw = Number(img.naturalWidth || img.width || w);
  const ih = Number(img.naturalHeight || img.height || h);
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const { fx, fy } = ANCHOR_FRACTIONS[anchor];
  ctx.drawImage(img, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
}

// CSS object-position 매핑 (sizeAnchor → "x% y%")
function anchorToObjectPosition(anchor: AnchorPoint): string {
  const { fx, fy } = ANCHOR_FRACTIONS[anchor];
  return `${fx * 100}% ${fy * 100}%`;
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

async function loadImageAnyOrigin(src: string): Promise<HTMLImageElement> {
  // 1) direct with CORS
  try { return await loadImage(src, "anonymous"); } catch { /* fall through */ }
  // 2) direct without CORS (may taint canvas but works for readback-free draws — we do read, so this is last resort)
  // 3) proxy via download-file edge function to convert to same-origin blob
  try {
    const { data, error } = await supabase.functions.invoke("download-file", {
      body: { url: src, filename: "design.bin" },
    });
    if (error) throw error;
    const blob = data instanceof Blob ? data : new Blob([data as any]);
    const objUrl = URL.createObjectURL(blob);
    try {
      return await loadImage(objUrl, null);
    } finally {
      // Revoke after a tick so the image has decoded
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
    }
  } catch (e) {
    throw e;
  }
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

  const img = await loadImageAnyOrigin(designSrc);
  // 원본 비율을 유지한 채 카드 크기를 완전히 덮도록 확대(cover) 후, 초과되는 영역을 잘라낸다.
  // 원본을 카드 안에 축소해서 넣지 않고, 카드 크기에 맞게 확대한 뒤 넘치는 부분만 크롭한다.
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const targetAspect = out.width / out.height;
  const srcAspect = iw / ih;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (srcAspect > targetAspect) {
    // 원본이 더 넓다 → 좌우를 잘라낸다
    sw = ih * targetAspect;
    sx = (iw - sw) / 2;
  } else if (srcAspect < targetAspect) {
    // 원본이 더 좁다(더 길다) → 위아래를 잘라낸다
    sh = iw / targetAspect;
    sy = (ih - sh) / 2;
  }
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);

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
  | "issuedNo" | "mintedOn" | "grade" | "issuedBy" | "twincode" | "dmBarcode" | "signature"
  | "companyName" | "centerSlogan" | "nfcEnabled";

// 이미지 형태의 옵션 (텍스트가 아닌 비트맵/SVG 렌더링)
function isImageKey(key: OptionKey): boolean {
  return key === "twincode" || key === "dmBarcode" || key === "signature";
}

// 바운딩 박스 내 9개 기준점 (Illustrator reference point 스타일)
// t=top, m=middle, b=bottom / l=left, c=center, r=right
export type AnchorPoint =
  | "tl" | "tc" | "tr"
  | "ml" | "mc" | "mr"
  | "bl" | "bc" | "br";

const ANCHOR_FRACTIONS: Record<AnchorPoint, { fx: number; fy: number }> = {
  tl: { fx: 0,   fy: 0 },   tc: { fx: 0.5, fy: 0 },   tr: { fx: 1, fy: 0 },
  ml: { fx: 0,   fy: 0.5 }, mc: { fx: 0.5, fy: 0.5 }, mr: { fx: 1, fy: 0.5 },
  bl: { fx: 0,   fy: 1 },   bc: { fx: 0.5, fy: 1 },   br: { fx: 1, fy: 1 },
};

type TextAlign = "left" | "center" | "right";

interface OptionLayout {
  enabled: boolean;
  x: number;      // mm — anchor point의 카드 왼쪽 변으로부터의 거리
  y: number;      // mm — anchor point의 카드 위쪽 변으로부터의 거리
  w: number;      // mm
  h: number;      // mm (for images/svg); text uses fontSize
  fontSize: number; // mm (text height)
  anchor?: AnchorPoint; // 바운딩 박스 기준점 (기본: 텍스트="mc", 이미지="tl")
  sizeAnchor?: AnchorPoint; // 바운딩 박스 내부에서 이미지(정사각 코드 등)가 정렬될 기준점 (기본: "mc")
  align?: TextAlign; // 텍스트 정렬 (왼쪽/중앙/오른쪽)
  padding?: number; // mm — DM 바코드 흰 여백 (quiet zone)
  lockAspect?: boolean; // 이미지 옵션의 비율 잠금 (서명 등)
  fontId?: string;     // 텍스트 옵션별 글꼴 (FONT_OPTIONS.id). 미지정 시 DEFAULT_MASTER_FONT.
  fontWeight?: number; // 텍스트 옵션별 BOLD 강도 (300~900). 미지정 시 DEFAULT_MASTER_FONT_WEIGHT.
}

const FRONT_KEYS: OptionKey[] = ["cpValue", "editionNo"];
const BACK_KEYS: OptionKey[] = ["issuedNo", "mintedOn", "grade", "issuedBy", "signature", "twincode", "dmBarcode", "companyName", "centerSlogan", "nfcEnabled"];

const OPTION_LABELS: Record<OptionKey, string> = {
  cpValue: "CP값",
  editionNo: "EDITION No.",
  issuedNo: "ISSUED No.",
  mintedOn: "Minted on",
  grade: "등급",
  issuedBy: "ISSUED BY",
  twincode: "트윈코드",
  dmBarcode: "DM 바코드",
  signature: "서명 파일",
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

// 도형(SVG) 옵션 — 카드 앞면(중심/외곽) + 카드 뒷면(단일 도형)
// SVG 원본 실제 크기를 사용하며, 카드 위 위치(x_mm, y_mm)와 기준점/색상을 지정한다.
// 색상은 API 연동 전까지 테스트용 직접 입력 값을 사용한다.
export type ShapeAnchor = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";
export interface ShapeOption {
  svgDataUrl: string | null;
  fileName: string | null;
  x_mm: number;
  y_mm: number;
  anchor: ShapeAnchor;
  color: string; // 테스트 색상 (#RRGGBB)
}
const makeShapeOption = (color: string): ShapeOption => ({
  svgDataUrl: null,
  fileName: null,
  x_mm: 28.5,
  y_mm: 43.5,
  anchor: "mc",
  color,
});
export interface ShapeOptions {
  frontCenter: ShapeOption;
  frontOutline: ShapeOption;
  back: ShapeOption;
  backLine: ShapeOption;
}
const DEFAULT_SHAPE_OPTIONS: ShapeOptions = {
  frontCenter: makeShapeOption("#E63946"),
  frontOutline: makeShapeOption("#1D3557"),
  back: makeShapeOption("#457B9D"),
  backLine: makeShapeOption("#000000"),
};
const SHAPE_ANCHORS: { value: ShapeAnchor; label: string }[] = [
  { value: "tl", label: "좌상" }, { value: "tc", label: "상중" }, { value: "tr", label: "우상" },
  { value: "ml", label: "좌중" }, { value: "mc", label: "중앙" }, { value: "mr", label: "우중" },
  { value: "bl", label: "좌하" }, { value: "bc", label: "하중" }, { value: "br", label: "우하" },
];

// 카드 등급별 기본 도형 옵션 — 추가설정 페이지에서 등급별로 SVG를 지정할 수 있다.
export type CardGrade = "COMMON" | "RARE" | "EPIC" | "LEGEND";
export const CARD_GRADES_ADVANCED: CardGrade[] = ["RARE", "EPIC", "LEGEND"];
const GRADE_LABEL: Record<CardGrade, string> = { COMMON: "COMMON", RARE: "RARE", EPIC: "EPIC", LEGEND: "LEGEND" };
export type ShapeOptionsByGrade = Partial<Record<CardGrade, ShapeOptions>>;
const cloneDefaultShapeOptions = (): ShapeOptions => ({
  frontCenter:  makeShapeOption("#E63946"),
  frontOutline: makeShapeOption("#1D3557"),
  back:         makeShapeOption("#457B9D"),
  backLine:     makeShapeOption("#000000"),
});
const DEFAULT_SHAPE_OPTIONS_BY_GRADE: ShapeOptionsByGrade = {
  RARE:   cloneDefaultShapeOptions(),
  EPIC:   cloneDefaultShapeOptions(),
  LEGEND: cloneDefaultShapeOptions(),
};
function normalizeGrade(g: unknown): CardGrade {
  const s = String(g ?? "").trim().toUpperCase();
  if (s === "RARE" || s === "EPIC" || s === "LEGEND") return s;
  return "COMMON";
}
function mergeShapeOptions(base: ShapeOptions, patch: any): ShapeOptions {
  const p = patch || {};
  return {
    frontCenter:  { ...base.frontCenter,  ...(p.frontCenter  || {}) },
    frontOutline: { ...base.frontOutline, ...(p.frontOutline || {}) },
    back:         { ...base.back,         ...(p.back         || {}) },
    backLine:     { ...base.backLine,     ...(p.backLine     || {}) },
  };
}

// ---- SVG 도형 유틸 (도형 옵션 → 미리보기/PDF 공통) ----
// data:image/svg+xml;base64,... 또는 utf-8 데이터 URL을 SVG 원문 문자열로 디코드
function decodeSvgDataUrl(dataUrl: string): string | null {
  try {
    if (dataUrl.startsWith("data:image/svg+xml;base64,")) {
      const b64 = dataUrl.slice("data:image/svg+xml;base64,".length);
      const bin = atob(b64);
      // UTF-8 decode
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }
    if (dataUrl.startsWith("data:image/svg+xml")) {
      const idx = dataUrl.indexOf(",");
      if (idx >= 0) return decodeURIComponent(dataUrl.slice(idx + 1));
    }
  } catch {}
  return null;
}

// SVG의 자연 크기를 mm로 반환 — 원본 SVG 크기를 변형 없이 그대로 사용한다.
// width/height에 명시 단위(mm/cm/in/pt/pc)가 있으면 그 값을 그대로 사용.
// 단위 없는 숫자 또는 px / viewBox의 사용자 단위는 인쇄 표준인 72 DPI(1 user unit = 1pt)
// 로 환산해 디자인 툴(Illustrator/Sketch 등)에서 내보낸 원본 사이즈가 보존되도록 한다.
function svgNaturalSizeMm(svgString: string): { w: number; h: number } {
  const USER_UNIT_TO_MM = 25.4 / 72; // 1 user unit(=1pt) → mm
  const parseLen = (raw: string): number | null => {
    const m = raw.match(/^([\d.]+)\s*(mm|cm|in|pt|pc|px)?$/i);
    if (!m) return null;
    const n = Number(m[1]); const u = (m[2] || "").toLowerCase();
    switch (u) {
      case "mm": return n;
      case "cm": return n * 10;
      case "in": return n * 25.4;
      case "pt": return n * (25.4 / 72);
      case "pc": return n * (25.4 / 6);
      case "px": return n * USER_UNIT_TO_MM; // px도 사용자 단위와 동일하게 취급(원본 크기 보존)
      default:   return n * USER_UNIT_TO_MM; // 단위 없음 → 사용자 단위(=pt)
    }
  };
  const wm = svgString.match(/\bwidth\s*=\s*"([^"]+)"/i);
  const hm = svgString.match(/\bheight\s*=\s*"([^"]+)"/i);
  if (wm && hm) {
    const w = parseLen(wm[1].trim()); const h = parseLen(hm[1].trim());
    if (w && h) return { w, h };
  }
  const vb = svgString.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) {
      return { w: p[2] * USER_UNIT_TO_MM, h: p[3] * USER_UNIT_TO_MM };
    }
  }
  return { w: 10, h: 10 };
}

// SVG 내부의 fill/stroke 값을 테스트 색상으로 일괄 치환 ("none"은 보존)
// 추가로 루트 <svg>에 fill/color 속성을 주입해 미지정 요소까지 색이 적용되게 한다.
function recolorSvgString(svgString: string, color: string): string {
  let out = svgString;
  // fill="..." (none 보존)
  out = out.replace(/(fill\s*=\s*")([^"]*)(")/gi, (_m, a, val, c) =>
    /^none$/i.test(val.trim()) ? `${a}${val}${c}` : `${a}${color}${c}`,
  );
  // stroke="..." (none 보존, 없는 경우는 추가하지 않음)
  out = out.replace(/(stroke\s*=\s*")([^"]*)(")/gi, (_m, a, val, c) =>
    /^none$/i.test(val.trim()) ? `${a}${val}${c}` : `${a}${color}${c}`,
  );
  // style="...fill:xxx;stroke:xxx..." 내부
  out = out.replace(/(fill\s*:\s*)([^;"'}]+)/gi, (_m, a, val) =>
    /^none$/i.test(val.trim()) ? `${a}${val}` : `${a}${color}`,
  );
  out = out.replace(/(stroke\s*:\s*)([^;"'}]+)/gi, (_m, a, val) =>
    /^none$/i.test(val.trim()) ? `${a}${val}` : `${a}${color}`,
  );
  // 루트 svg 태그에 fill/color 강제 주입 (속성 미지정 요소 대비)
  out = out.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    let a = attrs as string;
    if (!/\bfill\s*=/.test(a)) a += ` fill="${color}"`;
    if (!/\bcolor\s*=/.test(a)) a += ` color="${color}"`;
    return `<svg${a}>`;
  });
  return out;
}

// 서명 이미지의 기본 인쇄 크기 (mm) — 업로드된 이미지의 자연 비율을 모를 때 fallback
const SIGNATURE_BASE_W_MM = 20;
const SIGNATURE_BASE_H_MM = 8;

// 텍스트/이미지 유형별 기본 anchor 보정 — 저장값에 anchor가 없으면 사용
function defaultAnchorForKey(key: OptionKey): AnchorPoint {
  return isImageKey(key) ? "tl" : "mc";
}
function getAnchor(key: OptionKey, cfg: { anchor?: AnchorPoint }): AnchorPoint {
  return cfg.anchor ?? defaultAnchorForKey(key);
}
// 박스 좌상단 좌표 계산: (x,y)는 anchor 지점이므로 anchor fraction만큼 빼준다
function anchorTopLeft(x: number, y: number, w: number, h: number, anchor: AnchorPoint) {
  const { fx, fy } = ANCHOR_FRACTIONS[anchor];
  return { left: x - w * fx, top: y - h * fy };
}

const DEFAULT_LAYOUT: Record<OptionKey, OptionLayout> = {
  cpValue:     { enabled: true, x: 28.5, y: 14, w: 30, h: 8,  fontSize: 4,   anchor: "mc" },
  editionNo:   { enabled: true, x: 28.5, y: 43, w: 30, h: 6,  fontSize: 3.5, anchor: "mc" },
  issuedNo:    { enabled: true, x: 5,    y: 7,  w: 30, h: 5,  fontSize: 3,   anchor: "ml" },
  mintedOn:    { enabled: true, x: 5,    y: 14, w: 35, h: 5,  fontSize: 3,   anchor: "ml" },
  grade:       { enabled: true, x: 52,   y: 8,  w: 25, h: 6,  fontSize: 4,   anchor: "mr", fontWeight: 700 },
  issuedBy:    { enabled: true, x: 52,   y: 41, w: 25, h: 12, fontSize: 3,   anchor: "mr" },
  twincode:    { enabled: true, x: 5,    y: 25, w: 14, h: 14, fontSize: 0,   anchor: "tl" },
  dmBarcode:   { enabled: true, x: 60,   y: 18, w: 14, h: 14, fontSize: 0,   anchor: "tl", padding: 0.5 },
  signature:   { enabled: true, x: 28.5, y: 65, w: SIGNATURE_BASE_W_MM, h: SIGNATURE_BASE_H_MM, fontSize: 0, anchor: "mc", lockAspect: true },
  companyName: { enabled: true, x: 28.5, y: 77, w: 47, h: 5,  fontSize: 3,   anchor: "mc" },
  centerSlogan:{ enabled: true, x: 28.5, y: 52, w: 47, h: 5,  fontSize: 3.5, anchor: "mc" },
  nfcEnabled:  { enabled: true, x: 28.5, y: 84, w: 47, h: 4,  fontSize: 2.5, anchor: "mc" },
};

function defaultAlignForOption(key: OptionKey): TextAlign {
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
function getAlign(key: OptionKey, cfg: { align?: TextAlign }): TextAlign {
  return cfg.align ?? defaultAlignForOption(key);
}

function getOptionFontId(cfg: { fontId?: string }): string {
  const id = cfg.fontId ?? DEFAULT_MASTER_FONT;
  return FONT_OPTIONS.some(f => f.id === id) ? id : DEFAULT_MASTER_FONT;
}
function getOptionFontCss(cfg: { fontId?: string }): string {
  const opt = FONT_OPTIONS.find(f => f.id === getOptionFontId(cfg)) ?? FONT_OPTIONS[0];
  return opt.css;
}
function getOptionFontWeight(cfg: { fontWeight?: number }): number {
  const w = cfg.fontWeight;
  return typeof w === "number" && w >= 100 && w <= 900 ? w : DEFAULT_MASTER_FONT_WEIGHT;
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

interface CardData {
  seq: number;
  orderNo: string;            // 개별 주문번호 (item.order_id)
  uniqueNo: string;           // orderNo-4
  uid: string;                // NFC 칩 굽기 데이터 (nfc_ndef_data)
  cpValue: string;
  editionNo: string;
  issuedNo: string;
  mintedOn: string;
  grade: string;
  frontIconInnerColor: string;
  frontIconOuterColor: string;
  backIconColor: string;
  issuedByUrl: string | null; // 싸인 링크 (sign_url)
  twincode: string;
  twincodeSvgUrl: string | null;
  signatureUrl: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  gftOriginalUrl: string | null; // GFT 원본 이미지 (엑셀 Y열)
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

// ---------- DataMatrix via bwip-js → PNG bytes (legacy raster, kept for fallback) ----------
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

// ---------- DataMatrix via bwip-js → SVG string (vector for PDF) ----------
function dataMatrixSvgString(text: string): string {
  return (bwipjs as any).toSVG({
    bcid: "datamatrix",
    text: text || "TWINMETA",
    scale: 4,
    paddingwidth: 0,
    paddingheight: 0,
    includetext: false,
  });
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

/**
 * SVG 문자열을 브라우저에서 래스터화해 PNG 바이트로 돌려준다.
 * svg2pdf.js는 <clipPath>/<mask>/<image> 조합을 제대로 처리하지 못해
 * 클리핑 마스크가 사라진 원본 이미지가 그대로 노출되는 문제가 있어,
 * 해당 케이스에서는 브라우저 렌더링 결과(PNG)를 임베드해 정확도를 유지한다.
 */
async function rasterizeSvgToPng(svgString: string, widthMm: number, heightMm: number, dpi = 600): Promise<Uint8Array> {
  const pxPerMm = dpi / 25.4;
  const w = Math.max(8, Math.round(widthMm * pxPerMm));
  const h = Math.max(8, Math.round(heightMm * pxPerMm));
  // Ensure explicit viewBox so the browser scales the SVG correctly.
  let svg = svgString;
  if (!/\sviewBox\s*=/.test(svg)) {
    const wm = svg.match(/\bwidth\s*=\s*"([\d.]+)/i);
    const hm = svg.match(/\bheight\s*=\s*"([\d.]+)/i);
    const vw = wm ? Number(wm[1]) : 100;
    const vh = hm ? Number(hm[1]) : 100;
    svg = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${vw} ${vh}"`);
  }
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("svg rasterize failed"));
      i.src = objUrl;
    });
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await canvasToPngBytes(c);
  } finally {
    URL.revokeObjectURL(objUrl);
  }
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
  const { data: ordersData, isLoading, isFetching, error: ordersError, refetch: refetchOrders } = useOrders();
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
                {!isLoading && ordersError && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-destructive">
                      <div className="flex flex-col items-center gap-2">
                        <span>주문 조회 권한 오류가 발생했습니다</span>
                        <Button size="sm" variant="outline" onClick={() => refetchOrders()} disabled={isFetching}>
                          {isFetching ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                          다시 불러오기
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !ordersError && rows.length === 0 && (
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
    return Array.from({ length: count }, (_, idx) => {
      const it = items[idx] || {};
      const sd = order.source_data || {};
      const individualOrderNo = String(it.order_id ?? it.orderId ?? `${orderNo}-${idx + 1}`);
      const uniqueNo = `${individualOrderNo}-4`;
      return {
        seq: idx + 1,
        orderNo: individualOrderNo,
        uniqueNo,
        uid: String(it.nfc_ndef_data ?? it.uid ?? it.UID ?? sd.nfc_ndef_data ?? sd.uid ?? ""),
        cpValue: normalizeCpValue(it.cp_value ?? it.cp ?? sd.cp_value ?? sd.cp ?? ""),
        editionNo: String(it.edition ?? it.edition_no ?? sd.edition_no ?? `${idx + 1}`),
        issuedNo: String(it.issued_no ?? sd.issued_no ?? `${idx + 1}`),
        mintedOn: String(it.minted_on ?? sd.minted_on ?? fmtDate(order.created_at)),
        grade: String(it.grade ?? sd.grade ?? order.grade ?? "COMMON").toUpperCase(),
        frontIconInnerColor: String(it.card_front_icon_inner_color ?? sd.card_front_icon_inner_color ?? ""),
        frontIconOuterColor: String(it.card_front_icon_outer_color ?? sd.card_front_icon_outer_color ?? ""),
        backIconColor: String(it.card_back_icon_color ?? sd.card_back_icon_color ?? ""),
        issuedByUrl: it.sign_url ?? it.issued_by_url ?? sd.sign_url ?? sd.issued_by_url ?? null,
        twincode: String(it.twincode ?? it.twin_code ?? it.twincode_no ?? sd.twincode ?? sd.twin_code ?? ""),
        twincodeSvgUrl: it.twincode_svg_url ?? it.svg_url ?? sd.twincode_svg_url ?? null,
        signatureUrl: it.signature_url ?? it.signature_svg_url ?? sd.signature_url ?? sd.signature_svg_url ?? null,
        frontImageUrl: it.card_front_url ?? sd.card_front_url ?? it.gft_original_image_url ?? sd.gft_original_image_url ?? null,
        backImageUrl: it.card_back_url ?? sd.card_back_url ?? null,
        gftOriginalUrl: it.gft_original_image_url ?? sd.gft_original_image_url ?? null,
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

  // ===== 발주 진행 상태 =====
  const progressKey = `nfc-card.progress.v1.${orderNo}`;
  const [confirmedWO, setConfirmedWO] = useState(false);
  const [confirmedFiles, setConfirmedFiles] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [openWO, setOpenWO] = useState(false);
  const [openFiles, setOpenFiles] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState<{ stage: string; current: number; total: number } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(progressKey);
      if (raw) {
        const s = JSON.parse(raw);
        setConfirmedWO(!!s.confirmedWO); setConfirmedFiles(!!s.confirmedFiles); setOrdered(!!s.ordered);
      } else { setConfirmedWO(false); setConfirmedFiles(false); setOrdered(false); }
    } catch {}
  }, [progressKey]);
  const persistProgress = (next: { confirmedWO?: boolean; confirmedFiles?: boolean; ordered?: boolean }) => {
    const merged = { confirmedWO, confirmedFiles, ordered, ...next };
    try { localStorage.setItem(progressKey, JSON.stringify(merged)); } catch {}
  };


  // Test images per side (server-persisted; falls back to API card image when removed)
  const [testImages, setTestImages] = useState<{
    front: TestAsset | null;
    back: TestAsset | null;
  }>({ front: null, back: null });

  // 등급별 뒷면 이미지 (서버 저장) — COMMON/RARE/EPIC/LEGEND
  const [testBackImagesByGrade, setTestBackImagesByGrade] = useState<Record<CardGrade, TestAsset | null>>({
    COMMON: null, RARE: null, EPIC: null, LEGEND: null,
  });
  const [backImagesDialogOpen, setBackImagesDialogOpen] = useState(false);
  const resolveTestBackAsset = (grade: unknown): TestAsset | null => {
    const g = normalizeGrade(grade);
    return testBackImagesByGrade[g] || testBackImagesByGrade.COMMON || testImages.back || null;
  };

  // Test twincode SVG (server-persisted; falls back to API twincodeSvgUrl when removed)
  const [testTwincodeSvg, setTestTwincodeSvg] = useState<{ url: string; name: string } | null>(null);

  // Test signature file (server-persisted; falls back to API signatureUrl when removed)
  const [testSignature, setTestSignature] = useState<{ url: string; name: string } | null>(null);
  const [uploadDebug, setUploadDebug] = useState<UploadDebugInfo | null>(null);

  // Test values for preview only (override card[0] for front/back fields)
  const [testValues, setTestValues] = useState({
    cpValue: "", editionNo: "", issuedNo: "", mintedOn: "", grade: "",
  });

  // 카드 뒷면 기본 텍스트 (API 외 전체 카드에 공통 적용)
  const [backDefaults, setBackDefaults] = useState({ ...DEFAULT_BACK_DEFAULTS });
  // 도형(SVG) 옵션 상태 — 앞면(중심/외곽) + 뒷면(단일). 기본(COMMON) + 등급별 오버라이드
  const [shapeOptions, setShapeOptions] = useState<ShapeOptions>({ ...DEFAULT_SHAPE_OPTIONS });
  const [shapeOptionsByGrade, setShapeOptionsByGrade] = useState<ShapeOptionsByGrade>(() => ({
    RARE:   cloneDefaultShapeOptions(),
    EPIC:   cloneDefaultShapeOptions(),
    LEGEND: cloneDefaultShapeOptions(),
  }));
  const [advancedShapeOpen, setAdvancedShapeOpen] = useState(false);
  const resolveShapeOptions = (grade: unknown): ShapeOptions => {
    const g = normalizeGrade(grade);
    if (g === "COMMON") return shapeOptions;
    const per = shapeOptionsByGrade[g];
    if (!per) return shapeOptions;
    // 슬롯별 fallback: 등급별로 SVG가 업로드되지 않은 슬롯은 COMMON 값을 사용.
    // X/Y 좌표는 항상 COMMON(기본 도형 옵션) 값을 강제 적용해 위치를 동기화한다.
    const pickSlot = (key: keyof ShapeOptions): ShapeOption => {
      const slot = (per as any)[key] as ShapeOption | undefined;
      const base = (shapeOptions as any)[key] as ShapeOption;
      const src = slot && (slot.svgDataUrl || slot.fileName) ? slot : base;
      return { ...src, x_mm: base.x_mm, y_mm: base.y_mm };
    };
    return {
      frontCenter:  pickSlot("frontCenter"),
      frontOutline: pickSlot("frontOutline"),
      back:         pickSlot("back"),
      backLine:     pickSlot("backLine"),
    } as ShapeOptions;
  };


  // 마스터 글자꼴 (선택 시 카드 텍스트/숫자 미리보기 + PDF에 자동 적용)
  const [masterFont, setMasterFont] = useState<string>(DEFAULT_MASTER_FONT);
  const [masterFontWeight, setMasterFontWeight] = useState<number>(DEFAULT_MASTER_FONT_WEIGHT);
  

  // 브라우저 미리보기용: Spoqa는 로컬 TTF로 @font-face 등록, 나머지는 외부 CSS 링크 주입
  useEffect(() => {
    ensureSpoqaFontFace();
    FONT_OPTIONS.forEach(f => {
      if (!f.cssLink) return;
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

  // Load 등급별 뒷면 이미지 from storage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: list } = await supabase.storage.from(FRAME_BUCKET).list(TEST_BACK_IMG_PREFIX);
      if (cancelled) return;
      for (const grade of ["COMMON", "RARE", "EPIC", "LEGEND"] as CardGrade[]) {
        const found = (list || []).find(f => f.name.startsWith(`${grade}__`));
        if (!found) continue;
        const path = `${TEST_BACK_IMG_PREFIX}/${found.name}`;
        const { data: file } = await supabase.storage.from(FRAME_BUCKET).download(path);
        if (cancelled || !file) continue;
        const objUrl = URL.createObjectURL(file);
        const name = found.name.replace(new RegExp(`^${grade}__`), "");
        setTestBackImagesByGrade(prev => {
          revokeTestAsset(prev[grade]);
          return { ...prev, [grade]: { url: objUrl, name, path, objectUrl: true } };
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onUploadTestBackImageByGrade = async (grade: CardGrade, file: File | null) => {
    const { data: existing } = await supabase.storage.from(FRAME_BUCKET).list(TEST_BACK_IMG_PREFIX);
    const toRemove = (existing || [])
      .filter(f => f.name.startsWith(`${grade}__`))
      .map(f => `${TEST_BACK_IMG_PREFIX}/${f.name}`);
    if (toRemove.length) await supabase.storage.from(FRAME_BUCKET).remove(toRemove);
    if (!file) {
      setTestBackImagesByGrade(prev => {
        revokeTestAsset(prev[grade]);
        return { ...prev, [grade]: null };
      });
      toast({ title: `${grade} 뒷면 이미지 삭제됨` });
      return;
    }
    try {
      let uploadFile: Blob = file;
      let uploadName = file.name;
      const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
      let contentType = isSvg ? "image/svg+xml" : (file.type || "image/png");
      const isPdf = !isSvg && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
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
      const safe = uploadName.replace(/[^\w.-]+/g, "_");
      const path = `${TEST_BACK_IMG_PREFIX}/${grade}__${safe}`;
      await uploadNfcCardAsset(path, uploadFile, contentType);
      const objUrl = URL.createObjectURL(uploadFile);
      setTestBackImagesByGrade(prev => {
        revokeTestAsset(prev[grade]);
        return { ...prev, [grade]: { url: objUrl, name: file.name, path, objectUrl: true } };
      });
      toast({ title: `${grade} 뒷면 이미지 등록됨`, description: isPdf ? "PDF 첫 페이지가 이미지로 변환되었습니다" : undefined });
    } catch (e) {
      toast({ title: "업로드 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };



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
      const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
      let contentType = isSvg ? "image/svg+xml" : (file.type || "image/png");
      const isPdf = !isSvg && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
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
      const safe = uploadName.replace(/[^\w.-]+/g, "_");
      const path = `${TEST_IMG_PREFIX}/${side}__${safe}`;
      try {
        await uploadNfcCardAsset(path, uploadFile, contentType);
      } catch (error) {
        setUploadDebug(buildUploadDebugInfo({
          title: `${side === "front" ? "앞면" : "뒷면"} 테스트 이미지 업로드 실패`,
          objectPath: path,
          operation: "upload(upsert)",
          error,
          file: uploadFile,
          fileName: uploadName,
          contentType,
          userId,
        }));
        toast({ title: "업로드 실패", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        return;
      }
      setUploadDebug(null);
      const objUrl = URL.createObjectURL(uploadFile);
      setTestImages(prev => {
        revokeTestAsset(prev[side]);
        return { ...prev, [side]: { url: objUrl, name: file.name, path, objectUrl: true } };
      });
      toast({ title: `${side === "front" ? "앞면" : "뒷면"} 테스트 이미지 등록됨`, description: isPdf ? "PDF 첫 페이지가 이미지로 변환되었습니다" : undefined });
    } catch (e) {
      setUploadDebug(buildUploadDebugInfo({
        title: `${side === "front" ? "앞면" : "뒷면"} 테스트 이미지 처리 실패`,
        objectPath: `${TEST_IMG_PREFIX}/${side}__파일명_생성_전`,
        operation: "file processing before upload",
        error: e,
        file,
        fileName: file.name,
        contentType: file.type || "image/png",
        userId,
      }));
      toast({ title: "업로드 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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
      const safe = file.name.replace(/[^\w.-]+/g, "_");
      const path = `${TEST_TWINCODE_PREFIX}/twincode__${safe}`;
      const contentType = file.type || "image/svg+xml";
      let uploaded: { publicUrl: string };
      try {
        uploaded = await uploadNfcCardAsset(path, file, contentType);
      } catch (error) {
        setUploadDebug(buildUploadDebugInfo({ title: "트윈코드 SVG 업로드 실패", objectPath: path, operation: "upload(upsert)", error, file, fileName: file.name, contentType, userId }));
        toast({ title: "업로드 실패", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        return;
      }
      setUploadDebug(null);
      setTestTwincodeSvg({ url: `${uploaded.publicUrl}?v=${Date.now()}`, name: file.name });
      toast({ title: "트윈코드 테스트 SVG 등록됨" });
    } catch (e) {
      setUploadDebug(buildUploadDebugInfo({ title: "트윈코드 SVG 처리 실패", objectPath: `${TEST_TWINCODE_PREFIX}/twincode__파일명_생성_전`, operation: "file processing before upload", error: e, file, fileName: file.name, contentType: file.type || "image/svg+xml", userId }));
      toast({ title: "업로드 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  // Load test signature from storage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: list } = await supabase.storage.from(FRAME_BUCKET).list(TEST_SIGNATURE_PREFIX);
      if (cancelled) return;
      const found = (list || []).find(f => f.name.startsWith("signature__"));
      if (!found) return;
      const path = `${TEST_SIGNATURE_PREFIX}/${found.name}`;
      const { data: pub } = supabase.storage.from(FRAME_BUCKET).getPublicUrl(path);
      const name = found.name.replace(/^signature__/, "");
      setTestSignature({ url: `${pub.publicUrl}?v=${Date.now()}`, name });
    })();
    return () => { cancelled = true; };
  }, []);

  const onUploadTestSignature = async (file: File | null) => {
    const { data: existing } = await supabase.storage.from(FRAME_BUCKET).list(TEST_SIGNATURE_PREFIX);
    const toRemove = (existing || [])
      .filter(f => f.name.startsWith("signature__"))
      .map(f => `${TEST_SIGNATURE_PREFIX}/${f.name}`);
    if (toRemove.length) await supabase.storage.from(FRAME_BUCKET).remove(toRemove);
    if (!file) {
      setTestSignature(null);
      toast({ title: "서명 테스트 파일 삭제됨", description: "원래 API 서명파일이 적용됩니다" });
      return;
    }
    try {
      const safe = file.name.replace(/[^\w.-]+/g, "_");
      const path = `${TEST_SIGNATURE_PREFIX}/signature__${safe}`;
      const ct = file.type || (/\.svg$/i.test(file.name) ? "image/svg+xml" : "image/png");
      let uploaded: { publicUrl: string };
      try {
        uploaded = await uploadNfcCardAsset(path, file, ct);
      } catch (error) {
        setUploadDebug(buildUploadDebugInfo({ title: "서명 파일 업로드 실패", objectPath: path, operation: "upload(upsert)", error, file, fileName: file.name, contentType: ct, userId }));
        toast({ title: "업로드 실패", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        return;
      }
      setUploadDebug(null);
      setTestSignature({ url: `${uploaded.publicUrl}?v=${Date.now()}`, name: file.name });
      toast({ title: "서명 테스트 파일 등록됨" });
    } catch (e) {
      setUploadDebug(buildUploadDebugInfo({ title: "서명 파일 처리 실패", objectPath: `${TEST_SIGNATURE_PREFIX}/signature__파일명_생성_전`, operation: "file processing before upload", error: e, file, fileName: file.name, contentType: file.type || "image/png", userId }));
      toast({ title: "업로드 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const [vectorizingSig, setVectorizingSig] = useState(false);

  // Vectorizer.AI를 사용해서 현재 서명파일(API 또는 테스트)을 SVG로 변환하여 저장
  const onVectorizeSignature = async () => {
    const srcUrl = testSignature?.url || (cards[0]?.signatureUrl ?? null);
    if (!srcUrl) {
      toast({ title: "서명 파일이 없습니다", description: "먼저 서명 파일을 업로드하거나 API 서명이 있는 카드를 선택하세요.", variant: "destructive" });
      return;
    }
    if (/\.svg(\?|$)/i.test(srcUrl)) {
      toast({ title: "이미 SVG 벡터입니다", description: "변환이 필요하지 않습니다." });
      return;
    }
    const mode = (localStorage.getItem(VECTORIZER_MODE_KEY) as "test" | "preview" | "production" | null) || "test";
    setVectorizingSig(true);
    try {
      const { data, error } = await supabase.functions.invoke("vectorize-image", {
        body: { imageUrl: srcUrl, mode },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const svgDataUrl: string = (data as any).svgDataUrl;
      // svgDataUrl -> Blob -> File -> upload via onUploadTestSignature
      const res = await fetch(svgDataUrl);
      const blob = await res.blob();
      const file = new File([blob], `signature_vectorized_${Date.now()}.svg`, { type: "image/svg+xml" });
      await onUploadTestSignature(file);
      toast({
        title: "AI 벡터 변환 완료",
        description: `모드: ${mode} · 크레딧: ${(data as any).credits ?? "-"} · 테스트 서명에 저장됨`,
      });
    } catch (e) {
      toast({ title: "Vectorizer.AI 변환 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setVectorizingSig(false);
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
          if (v.shapeOptions) setShapeOptions(prev => mergeShapeOptions(prev, v.shapeOptions));
          if (v.shapeOptionsByGrade) setShapeOptionsByGrade(prev => {
            const src = v.shapeOptionsByGrade || {};
            const next: ShapeOptionsByGrade = { ...prev };
            (CARD_GRADES_ADVANCED as CardGrade[]).forEach((g) => {
              next[g] = mergeShapeOptions(prev[g] || cloneDefaultShapeOptions(), src[g]);
            });
            return next;
          });
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
    const payload = { layoutFront, layoutBack, workOrder, testValues, backDefaults, shapeOptions, shapeOptionsByGrade, masterFont, masterFontWeight } as any;
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

  // ====== Build single-card PDF (2 pages: front + back) — VECTOR OUTPUT ======
  // - 텍스트: pdf-lib drawText + fontkit(Spoqa Han Sans Neo) 벡터 임베드
  // - 트윈코드 SVG, DM 바코드(SVG): jsPDF + svg2pdf.js로 벡터 PDF 변환 후 embedPdf
  // - 배경(카드 디자인), 서명 파일: PNG/JPEG 비트맵 그대로 embedImage
  const buildCardPdfBytes = async (card: CardData, opts?: { sides?: Array<"front" | "back"> }): Promise<Uint8Array> => {
    const out = await PDFDocument.create();
    out.registerFontkit(fontkit as any);

    // === Outline (vector path) fonts via opentype.js ===
    // Text is converted to vector outlines (= Illustrator "Create Outlines").
    // No font is embedded; each glyph becomes a pure vector shape — guaranteed identical
    // rendering on any PDF viewer / print RIP, no font-missing risk.
    // 각 텍스트 항목별로 선택된 (fontId, weight) 조합을 모두 수집해서 실제 글꼴 파일을 로드한다.
    // → 미리보기와 동일한 글꼴/너비/위치가 PDF에 반영된다.
    const otFontCache = new Map<string, any>();
    const loadOtf = async (fontId: string, weight: number): Promise<any> => {
      const key = `${fontId}@${weight}`;
      const hit = otFontCache.get(key);
      if (hit) return hit;
      try {
        if (fontId === "spoqa-han-sans-neo") {
          const bytes = await loadSpoqaFontBytes(weight);
          const otf = await loadOpentypeFont(bytes, `spoqa-${weight}`);
          otFontCache.set(key, otf);
          return otf;
        }
        const opt = FONT_OPTIONS.find(f => f.id === fontId);
        const url = opt?.pdfFontUrl?.(weight);
        if (url) {
          const res = await fetch(url);
          if (res.ok) {
            const bytes = new Uint8Array(await res.arrayBuffer());
            const otf = await loadOpentypeFont(bytes, key);
            otFontCache.set(key, otf);
            return otf;
          }
        }
      } catch (e) {
        console.warn(`PDF font load failed (${key}), falling back to Spoqa`, e);
      }
      // Fallback to Spoqa Medium so PDF generation never fails
      const fbBytes = await loadSpoqaFontBytes(weight);
      const fb = await loadOpentypeFont(fbBytes, `spoqa-${weight}`);
      otFontCache.set(key, fb);
      return fb;
    };

    // Pre-load every (fontId, weight) combination referenced by enabled text options.
    const pickFont = async (cfg: { fontId?: string; fontWeight?: number }) =>
      loadOtf(getOptionFontId(cfg), getOptionFontWeight(cfg));
    for (const k of FRONT_KEYS) if (!isImageKey(k) && layoutFront[k]?.enabled) await pickFont(layoutFront[k]);
    for (const k of BACK_KEYS)  if (!isImageKey(k) && layoutBack[k]?.enabled)  await pickFont(layoutBack[k]);

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

    const pageWpt = cardSize.width * MM;
    const pageHpt = cardSize.height * MM;

    // Embed an SVG string at the requested position with sizeAnchor-aware contain layout.
    // boxX/boxY/boxW/boxH are in mm (card-top-left coords). Returns the actual drawn rect (mm).
    const embedSvgVector = async (
      page: any,
      svgString: string,
      boxXmm: number, boxYmm: number, boxWmm: number, boxHmm: number,
      sizeAnchor: AnchorPoint,
    ): Promise<{ drawXmm: number; drawYmm: number; drawWmm: number; drawHmm: number }> => {
      const aspect = svgAspectRatio(svgString) || 1;
      const boxAspect = boxWmm / boxHmm;
      let drawWmm: number, drawHmm: number;
      if (aspect > boxAspect) { drawWmm = boxWmm; drawHmm = boxWmm / aspect; }
      else                    { drawHmm = boxHmm; drawWmm = boxHmm * aspect; }
      const { fx, fy } = ANCHOR_FRACTIONS[sizeAnchor];
      const drawXmm = boxXmm + (boxWmm - drawWmm) * fx;
      const drawYmm = boxYmm + (boxHmm - drawHmm) * fy;
      const subBytes = await svgStringToPdfBytes(svgString, drawWmm * MM, drawHmm * MM);
      const [embedded] = await out.embedPdf(subBytes, [0]);
      page.drawPage(embedded, {
        x: drawXmm * MM,
        y: pageHpt - (drawYmm + drawHmm) * MM,
        width: drawWmm * MM,
        height: drawHmm * MM,
      });
      return { drawXmm, drawYmm, drawWmm, drawHmm };
    };

    const drawSide = async (
      side: "front" | "back",
      layout: Record<OptionKey, OptionLayout>,
      keys: OptionKey[],
    ) => {
      const page = out.addPage([pageWpt, pageHpt]);

      // === Background design ===
      // 앞면: 주문 이미지가 있으면 그것을, 없으면 테스트 이미지를 사용.
      // 뒷면: "등급별 뒷면 이미지"가 배경 템플릿이므로 항상 우선 적용하고,
      //       없을 때만 주문의 backImageUrl → 기본 테스트 이미지를 대체값으로 사용.
      const gradeBackAsset = side === "back" ? resolveTestBackAsset(card.grade) : null;
      const realDesignUrl = side === "front" ? card.frontImageUrl : card.backImageUrl;
      const testAsset = side === "back"
        ? (gradeBackAsset || (realDesignUrl ? null : resolveTestBackAsset(card.grade)))
        : (realDesignUrl ? null : testImages[side]);
      const testIsSvg = !!testAsset && /\.svg$/i.test(testAsset.name || "");
      const designUrl = side === "back"
        ? (gradeBackAsset?.url || realDesignUrl || testAsset?.url || null)
        : (realDesignUrl || testAsset?.url || null);
      if (testIsSvg && testAsset) {
        // SVG 테스트 이미지: 파일에 지정된 원본 크기(mm)와 색상을 그대로 사용해 벡터 임베드(중앙 정렬).
        try {
          const svgText = await (await fetch(testAsset.url)).text();
          const nat = svgNaturalSizeMm(svgText);
          const xMm = (cardSize.width - nat.w) / 2;
          const yMm = (cardSize.height - nat.h) / 2;
          // clipPath/mask/이미지가 포함된 SVG는 svg2pdf.js 호환성 문제로 검은 배경만 남는 경우가 있어 래스터화 후 임베드.
          const hasClipOrMask = /<(clipPath|mask)\b|clip-path\s*=|mask\s*=/i.test(svgText);
          if (hasClipOrMask) {
            const pngBytes = await rasterizeSvgToPng(svgText, nat.w, nat.h, 600);
            const img = await out.embedPng(pngBytes);
            page.drawImage(img, {
              x: xMm * MM,
              y: pageHpt - (yMm + nat.h) * MM,
              width: nat.w * MM,
              height: nat.h * MM,
            });
          } else {
            const subBytes = await svgStringToPdfBytes(svgText, nat.w * MM, nat.h * MM);
            const [embedded] = await out.embedPdf(subBytes, [0]);
            page.drawPage(embedded, {
              x: xMm * MM,
              y: pageHpt - (yMm + nat.h) * MM,
              width: nat.w * MM,
              height: nat.h * MM,
            });
          }
        } catch (e) { console.warn("svg test image embed failed", e); }
      } else if (designUrl) {
        try {
          const pxPerMm = 300 / 25.4;
          const bgW = Math.max(64, Math.round(cardSize.width * pxPerMm));
          const bgH = Math.max(64, Math.round(cardSize.height * pxPerMm));
          const clipped = await composeMaskedCardCanvas(designUrl, null, bgW, bgH);
          const pngBytes = await canvasToPngBytes(clipped);
          const bgImg = await out.embedPng(pngBytes);
          page.drawImage(bgImg, { x: 0, y: 0, width: pageWpt, height: pageHpt });
        } catch (e) { console.warn("card design render failed", e); }
      }

      // === 기본 도형 옵션 (디자인 위 / 옵션 요소 아래) ===
      // 색상은 주문 데이터의 카드 아이콘 색상으로 재적용 (backLine 제외).
      const activeShapes = resolveShapeOptions(card.grade);
      const shapesForSide: { s: ShapeOption; color: string | null }[] = side === "front"
        ? [
            { s: activeShapes.frontOutline, color: (card.frontIconOuterColor || "").trim() || null },
            { s: activeShapes.frontCenter,  color: (card.frontIconInnerColor || "").trim() || null },
          ]
        : [
            { s: activeShapes.back,     color: (card.backIconColor || "").trim() || null },
            { s: activeShapes.backLine, color: null },
          ];
      for (const { s, color } of shapesForSide) {
        if (!s?.svgDataUrl) continue;
        try {
          const rawSvg = decodeSvgDataUrl(s.svgDataUrl);
          if (!rawSvg) continue;
          const raw = color ? recolorSvgString(rawSvg, color) : rawSvg;
          const nat = svgNaturalSizeMm(raw);
          const tl = anchorTopLeft(s.x_mm, s.y_mm, nat.w, nat.h, s.anchor);
          // clipPath/mask 및 embedded <image> 를 보존하려면 svg2pdf 대신 브라우저 래스터화가 필요.
          const hasClipOrMask = /<(clipPath|mask)\b|clip-path\s*=|mask\s*=/i.test(raw);
          if (hasClipOrMask) {
            const pngBytes = await rasterizeSvgToPng(raw, nat.w, nat.h, 600);
            const img = await out.embedPng(pngBytes);
            page.drawImage(img, {
              x: tl.left * MM,
              y: pageHpt - (tl.top + nat.h) * MM,
              width: nat.w * MM,
              height: nat.h * MM,
            });
          } else {
            const subBytes = await svgStringToPdfBytes(raw, nat.w * MM, nat.h * MM);
            const [embedded] = await out.embedPdf(subBytes, [0]);
            page.drawPage(embedded, {
              x: tl.left * MM,
              y: pageHpt - (tl.top + nat.h) * MM,
              width: nat.w * MM,
              height: nat.h * MM,
            });
          }
        } catch (e) { console.warn("shape svg embed failed", e); }
      }


      for (const key of keys) {
        const cfg = layout[key];
        if (!cfg?.enabled) continue;
        const anc = getAnchor(key, cfg);
        const tl = anchorTopLeft(cfg.x, cfg.y, cfg.w, cfg.h, anc);
        const xMm = tl.left;
        const yMm = tl.top;

        // ===== Twincode (SVG vector) =====
        if (key === "twincode") {
          const twincodeUrl = testTwincodeSvg?.url || card.twincodeSvgUrl;
          if (!twincodeUrl) continue;
          try {
            // 흰색 박스 배경 (기존 미리보기/PDF와 동일)
            page.drawRectangle({
              x: xMm * MM,
              y: pageHpt - (yMm + cfg.h) * MM,
              width: cfg.w * MM,
              height: cfg.h * MM,
              color: rgb(1, 1, 1),
            });
            const svgStr = await fetchSvgString(twincodeUrl);
            await embedSvgVector(page, svgStr, xMm, yMm, cfg.w, cfg.h, cfg.sizeAnchor ?? "mc");
          } catch (e) { console.warn("twincode vector embed fail", e); }
          continue;
        }

        // ===== DM Barcode (SVG vector) =====
        if (key === "dmBarcode") {
          try {
            const pad = Math.max(0, cfg.padding ?? 0);
            // Quiet zone (white box) including padding
            page.drawRectangle({
              x: (xMm - pad) * MM,
              y: pageHpt - (yMm + cfg.h + pad) * MM,
              width: (cfg.w + pad * 2) * MM,
              height: (cfg.h + pad * 2) * MM,
              color: rgb(1, 1, 1),
            });
            const svgStr = dataMatrixSvgString(card.uniqueNo);
            await embedSvgVector(page, svgStr, xMm, yMm, cfg.w, cfg.h, cfg.sizeAnchor ?? "mc");
          } catch (e) { console.warn("DM vector embed fail", e); }
          continue;
        }

        // ===== Signature (SVG vector if available, otherwise PNG/JPEG raster) =====
        if (key === "signature") {
          const sigUrl = testSignature?.url || card.signatureUrl;
          if (!sigUrl) continue;
          const isSvg = /\.svg(\?|$)/i.test(sigUrl) || (testSignature?.name || "").toLowerCase().endsWith(".svg");
          try {
            if (isSvg) {
              // 벡터 임베드 — Vectorizer.AI로 변환된 SVG를 그대로 PDF에 벡터로 박는다
              const svgStr = await fetchSvgString(sigUrl);
              await embedSvgVector(page, svgStr, xMm, yMm, cfg.w, cfg.h, cfg.sizeAnchor ?? "mc");
            } else {
              const pngBytes = await urlToPngBytes(sigUrl);
              const sigImg = await out.embedPng(pngBytes);
              const iw = sigImg.width;
              const ih = sigImg.height;
              const aspect = iw / ih;
              const boxAspect = cfg.w / cfg.h;
              let drawWmm: number, drawHmm: number;
              if (aspect > boxAspect) { drawWmm = cfg.w; drawHmm = cfg.w / aspect; }
              else                    { drawHmm = cfg.h; drawWmm = cfg.h * aspect; }
              const { fx, fy } = ANCHOR_FRACTIONS[cfg.sizeAnchor ?? "mc"];
              const drawXmm = xMm + (cfg.w - drawWmm) * fx;
              const drawYmm = yMm + (cfg.h - drawHmm) * fy;
              page.drawImage(sigImg, {
                x: drawXmm * MM,
                y: pageHpt - (drawYmm + drawHmm) * MM,
                width: drawWmm * MM,
                height: drawHmm * MM,
              });
            }
          } catch (e) { console.warn("signature embed fail", e); }
          continue;
        }

        // ===== Text (vector outlines via opentype.js) =====
        // 미리보기와 동일한 anchor/위치를 사용하되, 글리프를 벡터 패스로 변환해 PDF에 임베드한다.
        // (Illustrator "Create Outlines"와 동일 — 글꼴 임베드/누락 위험 없음)
        if (!isImageKey(key)) {
          const txt = textFor(key);
          if (!txt) continue;
          try {
            const weight = getOptionFontWeight(cfg);
            const family = getOptionFontCss(cfg);
            const fontSizeMm = cfg.fontSize || 3;
            const fontSizePt = fontSizeMm * MM;
            // 미리보기와 동일한 canvas 측정 기반 너비/높이로 anchor 계산 → 위치 일치 보장
            const autoWmm = measureTextWidthMm(txt, fontSizeMm, family, weight);
            const autoHmm = fontSizeMm;
            const anc2 = getAnchor(key, cfg);
            const tl2 = anchorTopLeft(cfg.x, cfg.y, autoWmm, autoHmm, anc2);
            // 정렬: 박스 너비(autoWmm) 안에서 left/center/right 보정
            const otf = await pickFont(cfg);
            const drawWith = (f: any) => {
              const glyphWidthPt = measureOutlineWidthPt(f, txt, fontSizePt);
              const boxWpt = autoWmm * MM;
              const align = getAlign(key, cfg);
              let drawXpt = tl2.left * MM;
              if (align === "center") drawXpt += (boxWpt - glyphWidthPt) / 2;
              else if (align === "right") drawXpt += boxWpt - glyphWidthPt;
              const ascentPt = outlineAscentPt(f, fontSizePt);
              const topYpt = pageHpt - tl2.top * MM;
              const baselineYpt = topYpt - ascentPt;
              drawTextAsOutline(page, f, txt, drawXpt, baselineYpt, fontSizePt, rgb(0, 0, 0));
            };
            try {
              drawWith(otf);
            } catch (e) {
              // Chosen font's GSUB/lookup subformat unsupported by opentype.js → render with Spoqa fallback so text is never empty.
              console.warn(`outline render failed for ${key}, falling back to Spoqa`, e);
              const fbBytes = await loadSpoqaFontBytes(weight);
              const fb = await loadOpentypeFont(fbBytes, `spoqa-${weight}`);
              drawWith(fb);
            }
          } catch (e) {
            console.warn(`text outline draw failed for ${key}`, e);
          }
        }
      }
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

  // 작업지시서 HTML — 미리보기와 PDF 변환에 공통으로 사용
  const workOrderHtml = useMemo(() => buildNfcWorkOrderHtml(workOrder), [workOrder]);

  // 발주: ZIP 생성 후 다운로드 (작업지시서.pdf + 카드 앞면/ + 카드 뒷면/)
  const handleFinalize = async () => {
    if (cards.length === 0) {
      toast({ title: "카드 데이터가 없습니다", variant: "destructive" as any });
      return;
    }
    setFinalizing(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      setFinalizeProgress({ stage: "작업지시서 PDF 생성", current: 0, total: 1 });
      const woBytes = await renderHtmlToPdfBytesA4(workOrderHtml);
      zip.file("작업지시서.pdf", woBytes);

      const frontDir = zip.folder("카드 앞면")!;
      const backDir = zip.folder("카드 뒷면")!;
      const usedFront = new Map<string, number>();
      const usedBack = new Map<string, number>();
      const total = cards.length;

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const base = card.uniqueNo || `card-${i + 1}`;

        setFinalizeProgress({ stage: `카드 앞면 PDF (${i + 1}/${total})`, current: i + 1, total });
        const frontBytes = await buildCardPdfBytes(card, { sides: ["front"] });
        const nf = usedFront.get(base) || 0;
        frontDir.file(nf === 0 ? `${base}.pdf` : `${base}(${nf}).pdf`, frontBytes);
        usedFront.set(base, nf + 1);

        setFinalizeProgress({ stage: `카드 뒷면 PDF (${i + 1}/${total})`, current: i + 1, total });
        const backBytes = await buildCardPdfBytes(card, { sides: ["back"] });
        const nb = usedBack.get(base) || 0;
        backDir.file(nb === 0 ? `${base}.pdf` : `${base}(${nb}).pdf`, backBytes);
        usedBack.set(base, nb + 1);
      }

      setFinalizeProgress({ stage: "ZIP 생성 중", current: total, total });
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${orderNo}_nfc-card_order_${tsName()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setOrdered(true);
      persistProgress({ ordered: true });
      toast({ title: "발주 ZIP 다운로드 완료", description: `${cards.length}장 · 작업지시서 포함` });
    } catch (e: any) {
      toast({ title: "발주 실패", description: e?.message || String(e), variant: "destructive" as any });
    } finally {
      setFinalizing(false);
      setFinalizeProgress(null);
    }
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

        {uploadDebug && (
          <UploadDebugPanel info={uploadDebug} onClose={() => setUploadDebug(null)} />
        )}

        {/* ===== 발주 진행 ===== */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="w-4 h-4" /> 발주 진행
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              <ProgressStep
                idx={1} label="작업지시서"
                done={confirmedWO} disabled={false}
                onClick={() => setOpenWO(true)}
              />
              <ProgressStep
                idx={2} label="작업파일 확인"
                done={confirmedFiles} disabled={!confirmedWO}
                onClick={() => setOpenFiles(true)}
              />
              <ProgressStep
                idx={3} label="발주 (ZIP 다운로드)"
                done={ordered} disabled={!confirmedWO || !confirmedFiles || finalizing}
                onClick={handleFinalize}
                busy={finalizing}
              />
            </div>
            {finalizeProgress && (
              <div className="text-xs text-muted-foreground border rounded-md p-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{finalizeProgress.stage}</span>
                  <span className="ml-auto tabular-nums">{finalizeProgress.current}/{finalizeProgress.total}</span>
                </div>
                <div className="mt-1 h-1.5 bg-background rounded overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${finalizeProgress.total ? Math.min(100, (finalizeProgress.current / finalizeProgress.total) * 100) : 0}%` }} />
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              ZIP 구조: <span className="font-mono">작업지시서.pdf</span> · <span className="font-mono">카드 앞면/</span> · <span className="font-mono">카드 뒷면/</span> (파일명: 카드 고유번호, 주문 상세 목록 순서)
            </p>
          </CardContent>
        </Card>

        {/* Step 1: 작업지시서 A4 미리보기 */}
        <Dialog open={openWO} onOpenChange={setOpenWO}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader><DialogTitle>작업지시서 미리보기 (A4)</DialogTitle></DialogHeader>
            <div className="flex-1 overflow-auto border rounded-md bg-white">
              <iframe title="nfc-wo-preview" srcDoc={workOrderHtml} className="w-full h-[70vh] bg-white" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenWO(false)}>닫기</Button>
              <Button onClick={() => { setConfirmedWO(true); persistProgress({ confirmedWO: true }); setOpenWO(false); toast({ title: "작업지시서 확인 완료" }); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Step 2: 작업파일 확인 (앞면/뒷면 썸네일) */}
        <Dialog open={openFiles} onOpenChange={setOpenFiles}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-4 h-4" /> 작업파일 확인 · 총 {cards.length}장
              </DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="front" className="flex-1 overflow-hidden flex flex-col">
              <TabsList>
                <TabsTrigger value="front">카드 앞면 ({cards.length})</TabsTrigger>
                <TabsTrigger value="back">카드 뒷면 ({cards.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="front" className="flex-1 overflow-auto pt-3">
                <CardThumbGrid cards={cards} side="front" testImageUrl={testImages.front?.url || null} />
              </TabsContent>
              <TabsContent value="back" className="flex-1 overflow-auto pt-3">
                <CardThumbGrid cards={cards} side="back" testImageUrl={testBackImagesByGrade.COMMON?.url || testImages.back?.url || null} backImagesByGrade={testBackImagesByGrade} />
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenFiles(false)}>닫기</Button>
              <Button onClick={() => { setConfirmedFiles(true); persistProgress({ confirmedFiles: true }); setOpenFiles(false); toast({ title: "작업파일 확인 완료" }); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>



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
            {/* 앞면 테스트 이미지 (단일) */}
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-medium text-xs">앞면 테스트 이미지</Label>
                {testImages.front && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600">서버 저장됨</span>
                )}
              </div>
              <div className="flex justify-center">
                <TestDesignThumb cardSize={cardSize} imageUrl={testImages.front?.url ?? null} />
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {testImages.front?.name || "삭제 전까지 서버에 유지됩니다"}
              </div>
              <div className="flex gap-2">
                <label className="flex-1 flex items-center justify-center gap-2 cursor-pointer text-xs px-3 py-2 border border-dashed rounded hover:bg-accent">
                  <Upload className="w-3 h-3" />
                  <span>{testImages.front ? "변경" : "이미지 업로드"}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg,application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0] || null; e.currentTarget.value = ""; if (f) onUploadTestImage("front", f); }} />
                </label>
                {testImages.front && (
                  <Button size="sm" variant="destructive" className="text-xs"
                    onClick={() => { if (confirm("테스트 이미지를 삭제하고 원래 API 디자인을 사용할까요?")) onUploadTestImage("front", null); }}>
                    <X className="w-3 h-3 mr-1" />삭제
                  </Button>
                )}
              </div>
            </div>

            {/* 등급별 뒷면 이미지 (COMMON/RARE/EPIC/LEGEND) */}
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-medium text-xs">등급별 뒷면 이미지</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {(["COMMON","RARE","EPIC","LEGEND"] as CardGrade[]).filter(g => testBackImagesByGrade[g]).length}/4 등급 설정됨
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(["COMMON","RARE","EPIC","LEGEND"] as CardGrade[]).map(g => (
                  <div key={g} className="flex flex-col items-center gap-1">
                    <div className="w-full aspect-[54/86] rounded border bg-muted/30 overflow-hidden flex items-center justify-center">
                      {testBackImagesByGrade[g]?.url
                        ? <img src={testBackImagesByGrade[g]!.url} alt={g} className="w-full h-full object-contain" />
                        : <span className="text-[10px] text-muted-foreground">미설정</span>}
                    </div>
                    <span className="text-[10px] font-mono">{g}</span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground">
                각 등급 카드의 뒷면 배경 이미지로 사용됩니다. (실제 주문 이미지가 있으면 그 이미지가 우선)
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setBackImagesDialogOpen(true)}>
                <Upload className="w-3 h-3 mr-1" />추가 설정
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 등급별 뒷면 이미지 업로드 다이얼로그 */}
        <BackImagesByGradeDialog
          open={backImagesDialogOpen}
          onOpenChange={setBackImagesDialogOpen}
          images={testBackImagesByGrade}
          onUpload={onUploadTestBackImageByGrade}
          cardSize={cardSize}
        />


        {/* Test twincode SVG upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">트윈코드 / 서명 테스트 파일 (서버 저장)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-medium text-xs">서명 파일 (PNG / SVG)</Label>
                {testSignature && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600">서버 저장됨</span>
                )}
              </div>
              <div className="w-full h-32 border rounded bg-muted/30 overflow-hidden flex items-center justify-center">
                {testSignature?.url
                  ? <img src={testSignature.url} alt="" className="w-full h-full object-contain bg-white" />
                  : <span className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="w-3 h-3" />테스트 서명 없음 (API 서명파일 사용)</span>}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {testSignature?.name || "테스트 종료 후 삭제하면 API 서명파일이 사용됩니다"}
              </div>
              <div className="flex gap-2">
                <label className="flex-1 flex items-center justify-center gap-2 cursor-pointer text-xs px-3 py-2 border border-dashed rounded hover:bg-accent">
                  <Upload className="w-3 h-3" />
                  <span>{testSignature ? "변경" : "서명 업로드"}</span>
                  <input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" className="hidden"
                    onChange={e => { const f = e.target.files?.[0] || null; e.currentTarget.value = ""; if (f) onUploadTestSignature(f); }} />
                </label>
                {testSignature && (
                  <Button size="sm" variant="destructive" className="text-xs"
                    onClick={() => { if (confirm("테스트 서명파일을 삭제하고 원래 API 서명을 사용할까요?")) onUploadTestSignature(null); }}>
                    <X className="w-3 h-3 mr-1" />삭제
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs gap-1"
                  onClick={onVectorizeSignature}
                  disabled={vectorizingSig}
                  title="Vectorizer.AI로 SVG 벡터로 변환 · 시스템 설정에서 모드 선택"
                >
                  {vectorizingSig ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
                  AI 벡터 변환 (Vectorizer.AI)
                </Button>
                {testSignature?.url && (/\.svg(\?|$)/i.test(testSignature.url) || (testSignature.name || "").toLowerCase().endsWith(".svg")) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-xs gap-1"
                    title="벡터 변환된 SVG 다운로드"
                    onClick={async () => {
                      try {
                        const r = await fetch(testSignature.url!);
                        if (!r.ok) throw new Error(`다운로드 실패: ${r.status}`);
                        const blob = await r.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = testSignature.name || `signature_vector_${Date.now()}.svg`;
                        document.body.appendChild(a); a.click(); a.remove();
                        URL.revokeObjectURL(url);
                      } catch (e) {
                        toast({ title: "다운로드 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
                      }
                    }}
                  >
                    <Download className="w-3 h-3" />
                    SVG 다운로드
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 마스터 글자꼴 UI는 제거되었습니다 — 각 텍스트 항목에서 글꼴/BOLD 강도를 개별 설정합니다. */}



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

        {/* 기본 도형 옵션 (앞면 중심/외곽 · 뒷면 단일) — 이미지 위 레이어로 합성됨 */}
        <ShapeOptionsCard
          value={shapeOptions}
          onChange={setShapeOptions}
          onSave={saveLayout}
          canSave={loaded}
          onOpenAdvanced={() => setAdvancedShapeOpen(true)}
        />
        <AdvancedShapeSettingsDialog
          open={advancedShapeOpen}
          onOpenChange={setAdvancedShapeOpen}
          value={shapeOptionsByGrade}
          onChange={setShapeOptionsByGrade}
          onSave={saveLayout}
          canSave={loaded}
          commonShapeOptions={shapeOptions}
        />

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
              testImageUrl={testImages.front?.url || null}
              cardPreview={applyTestValues(cards[0], testValues)}
              layout={layoutFront}
              setLayout={setLayoutFront}
              keys={FRONT_KEYS}
              shapeOptions={resolveShapeOptions(applyTestValues(cards[0], testValues)?.grade)}
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
              onSaveLayout={saveLayout}
              saveDisabled={!loaded}
            />
          </TabsContent>
          <TabsContent value="back" className="pt-3">
            <CardSideEditor
              side="back"
              cardSize={cardSize}
              bleedMm={bleedMm}
              testImageUrl={resolveTestBackAsset(applyTestValues(cards[0], testValues)?.grade)?.url || null}
              testTwincodeUrl={testTwincodeSvg?.url || null}
              testSignatureUrl={testSignature?.url || null}
              cardPreview={applyTestValues(cards[0], testValues)}
              layout={layoutBack}
              setLayout={setLayoutBack}
              keys={BACK_KEYS}
              backDefaults={backDefaults}
              shapeOptions={resolveShapeOptions(applyTestValues(cards[0], testValues)?.grade)}
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
              onSaveLayout={saveLayout}
              saveDisabled={!loaded}
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
          <CardHeader className="py-3">
            <CardTitle className="text-base">카드 목록 리스트</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">순번</TableHead>
                  <TableHead>주문번호</TableHead>
                  <TableHead>UID</TableHead>
                  <TableHead>카드 고유번호</TableHead>
                  <TableHead>등급</TableHead>
                  <TableHead>GFT 원본 이미지</TableHead>
                  <TableHead>앞면</TableHead>
                  <TableHead>뒷면</TableHead>
                  <TableHead>앞면 아이콘 내부색상</TableHead>
                  <TableHead>앞면 아이콘 외부색상</TableHead>
                  <TableHead>뒷면 아이콘 색상</TableHead>
                  <TableHead>CP값</TableHead>
                  <TableHead>EDITION</TableHead>
                  <TableHead>ISSUED No.</TableHead>
                  <TableHead>Minted on</TableHead>
                  <TableHead>ISSUED BY</TableHead>
                  <TableHead>트윈코드 이미지</TableHead>
                  <TableHead>DM 바코드</TableHead>
                  <TableHead className="text-right">다운로드</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.length === 0 && (
                  <TableRow><TableCell colSpan={18} className="text-center py-8 text-muted-foreground">—</TableCell></TableRow>
                )}
                {cards.map(c => (
                  <TableRow key={`${c.uniqueNo}-${c.seq}`}>
                    <TableCell className="tabular-nums">{c.seq}</TableCell>
                    <TableCell className="font-mono text-xs">{c.orderNo}</TableCell>
                    <TableCell className="font-mono text-xs">{c.uid}</TableCell>
                    <TableCell className="font-mono text-xs">{c.uniqueNo}</TableCell>
                    <TableCell><Badge variant="outline">{c.grade || "-"}</Badge></TableCell>
                    <TableCell>
                      {c.gftOriginalUrl
                        ? <a href={c.gftOriginalUrl} target="_blank" rel="noopener noreferrer"><CardFrame widthClassName="w-8" className="border rounded"><img src={c.gftOriginalUrl} alt="" className="w-full h-full object-cover" /></CardFrame></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      <CardPreviewCell
                        side="front"
                        card={c}
                        cardSize={cardSize}
                        testImageUrl={testImages.front?.url || null}
                        layout={layoutFront}
                        keys={FRONT_KEYS}
                        shapeOptions={resolveShapeOptions(c.grade)}
                      />
                    </TableCell>
                    <TableCell>
                      <CardPreviewCell
                        side="back"
                        card={c}
                        cardSize={cardSize}
                        testImageUrl={resolveTestBackAsset(c.grade)?.url || null}
                        testTwincodeUrl={testTwincodeSvg?.url || null}
                        testSignatureUrl={testSignature?.url || null}
                        layout={layoutBack}
                        keys={BACK_KEYS}
                        backDefaults={backDefaults}
                        shapeOptions={resolveShapeOptions(c.grade)}
                      />
                    </TableCell>
                    <TableCell><ColorSwatch value={c.frontIconInnerColor} /></TableCell>
                    <TableCell><ColorSwatch value={c.frontIconOuterColor} /></TableCell>
                    <TableCell><ColorSwatch value={c.backIconColor} /></TableCell>
                    <TableCell className="text-xs">{c.cpValue || "-"}</TableCell>
                    <TableCell className="text-xs">{c.editionNo}</TableCell>
                    <TableCell className="text-xs">{c.issuedNo}</TableCell>
                    <TableCell className="text-xs">{c.mintedOn}</TableCell>
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
                    <TableCell><DmThumb text={c.uniqueNo} /></TableCell>
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
  // Prefer real linked order data; only fall back to test values when the field is empty.
  return {
    ...c,
    cpValue:   normalizeCpValue(c.cpValue) || normalizeCpValue(tv.cpValue),
    editionNo: c.editionNo || tv.editionNo,
    issuedNo:  c.issuedNo  || tv.issuedNo,
    mintedOn:  c.mintedOn  || tv.mintedOn,
    grade:     c.grade     || tv.grade,
  };
}

// ============== Card side editor (preview + per-option controls) ==============
function CardSideEditor({
  side, cardSize, testImageUrl, testTwincodeUrl, testSignatureUrl, cardPreview, layout, setLayout, keys, backDefaults, onTestPdf, onSaveLayout, saveDisabled,
  bleedMm, shapeOptions,
}: {
  side: "front" | "back";
  cardSize: CardSize;
  testImageUrl?: string | null;
  testTwincodeUrl?: string | null;
  testSignatureUrl?: string | null;
  cardPreview?: CardData;
  layout: Record<OptionKey, OptionLayout>;
  setLayout: React.Dispatch<React.SetStateAction<Record<OptionKey, OptionLayout>>>;
  keys: OptionKey[];
  backDefaults?: { companyName: string; centerSlogan: string; nfcEnabled: string; issuedBy: string };
  onTestPdf?: () => void | Promise<void>;
  onSaveLayout?: () => void | Promise<void>;
  saveDisabled?: boolean;
  shapeOptions?: ShapeOptions;
  bleedMm: number;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  // 결과물 미리보기 모드: 편집 UI(드래그 박스/라벨/가이드)를 숨기고 실제 인쇄 결과물만 표시
  const [resultOnly, setResultOnly] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 카드 크기는 저장된 사이즈 설정을 따른다 (기본 57×87mm).
  const cardWmm = cardSize.width;
  const cardHmm = cardSize.height;
  const PX_PER_MM_REAL = 96 / 25.4;
  const PREVIEW_SCALE = 2;
  const pxPerMm = PX_PER_MM_REAL * PREVIEW_SCALE;
  const previewW = cardWmm * pxPerMm;
  const previewH = cardHmm * pxPerMm;
  // 인쇄에 포함되지 않는 가이드 라인 (57×87mm 정중앙 기준)
  const GUIDE_W_MM = 57;
  const GUIDE_H_MM = 87;
  const guideWpx = GUIDE_W_MM * pxPerMm;
  const guideHpx = GUIDE_H_MM * pxPerMm;
  const guideLeftPx = ((cardWmm - GUIDE_W_MM) / 2) * pxPerMm;
  const guideTopPx = ((cardHmm - GUIDE_H_MM) / 2) * pxPerMm;



  const [selected, setSelected] = useState<OptionKey | null>(keys[0] ?? null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const clampZoom = (z: number) => Math.max(0.5, Math.min(4, Math.round(z * 100) / 100));


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
    const isImage = isImageKey(key);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dxMm = (ev.clientX - startX) / (pxPerMm * zoom);
      const dyMm = (ev.clientY - startY) / (pxPerMm * zoom);
      if (mode === "move") {
        // 텍스트(autoSize)는 컨테이너 너비/높이가 가변이므로 카드 전체 범위로 클램프
        const maxX = isImage ? cardWmm - cfg.w : cardWmm;
        const maxY = isImage ? cardHmm - cfg.h : cardHmm;
        update(key, {
          x: clampMm(startMm.x + dxMm, maxX),
          y: clampMm(startMm.y + dyMm, maxY),
        });
      } else {
        if (key === "dmBarcode") {
          // square: keep w == h
          const size = clampMm(startMm.w + Math.max(dxMm, dyMm), Math.min(cardWmm - cfg.x, cardHmm - cfg.y));
          update(key, { w: size, h: size });
        } else if (cfg.lockAspect && startMm.w > 0 && startMm.h > 0) {
          // 비율 유지: 너비 변화량 기준으로 높이 동기화
          const ratio = startMm.h / startMm.w;
          const newW = clampMm(startMm.w + dxMm, cardWmm - cfg.x);
          const newH = clampMm(newW * ratio, cardHmm - cfg.y);
          update(key, { w: newW, h: newH });
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
        const bytes = await dataMatrixPngBytes(cardPreview.uniqueNo, 200);
        if (cancelled) return;
        const blob = new Blob([bytes as BlobPart], { type: "image/png" });
        setDmPreview(URL.createObjectURL(blob));
      } catch {}
    })();
    return () => { cancelled = true; if (dmPreview) URL.revokeObjectURL(dmPreview); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPreview?.uniqueNo, keys.join(",")]);

  const designUrl = (side === "front" ? cardPreview?.frontImageUrl : cardPreview?.backImageUrl) || testImageUrl || null;
  const [clippedPreview, setClippedPreview] = useState<string | null>(null);
  const [svgPreview, setSvgPreview] = useState<{ url: string; wMm: number; hMm: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!designUrl) { setClippedPreview(null); setSvgPreview(null); return; }
    (async () => {
      try {
        // SVG 감지 — 원본 크기/색상 보존 모드로 렌더
        const head = await (await fetch(designUrl)).text().catch(() => "");
        if (/^\s*<\?xml[\s\S]*?<svg[\s>]/i.test(head) || /^\s*<svg[\s>]/i.test(head)) {
          const nat = svgNaturalSizeMm(head);
          if (!cancelled) { setSvgPreview({ url: designUrl, wMm: nat.w, hMm: nat.h }); setClippedPreview(null); }
          return;
        }
        const canvas = await composeMaskedCardCanvas(designUrl, null, previewW, previewH);
        if (!cancelled) { setClippedPreview(canvas.toDataURL("image/png")); setSvgPreview(null); }
      } catch {
        if (!cancelled) { setClippedPreview(designUrl); setSvgPreview(null); }
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
        return !!cfg?.enabled && !isImageKey(key) && !!textFor(key);
      });
      await Promise.all(drawableKeys.map(key => {
        const cfg = layout[key];
        const fontPx = Math.max(4, (cfg.fontSize || 3) * pxPerMm);
        const weight = getOptionFontWeight(cfg);
        const family = getOptionFontCss(cfg);
        return (document as any).fonts?.load(`${weight} ${fontPx}px ${family}`);
      }));
      if (cancelled) return;
      ctx.clearRect(0, 0, previewW, previewH);
      drawableKeys.forEach(key => {
        const cfg = layout[key];
        const txt = textFor(key);
        const weight = getOptionFontWeight(cfg);
        const family = getOptionFontCss(cfg);
        const autoWmm = measureTextWidthMm(txt, cfg.fontSize || 3, family, weight);
        const autoHmm = cfg.fontSize || 3;
        const anc = getAnchor(key, cfg);
        const tl = anchorTopLeft(cfg.x, cfg.y, autoWmm, autoHmm, anc);
        const xMm = tl.left;
        const yMm = tl.top;
        const fontPx = Math.max(4, (cfg.fontSize || 3) * pxPerMm);
        drawCanvasTextElement(ctx, txt, xMm * pxPerMm, yMm * pxPerMm, autoWmm * pxPerMm, fontPx, family, weight, getAlign(key, cfg));
      });
    })();
    return () => { cancelled = true; };
  }, [backDefaults, cardHmm, cardPreview, cardWmm, keys, layout, previewH, previewW, pxPerMm]);

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
        const tcUrl = cardPreview.twincodeSvgUrl || testTwincodeUrl;
        const pos = anchorToObjectPosition(layout.twincode?.sizeAnchor ?? "mc");
        return tcUrl
          ? <img src={tcUrl} alt="" className="w-full h-full object-contain bg-white pointer-events-none" style={{ objectPosition: pos }} />
          : <span className="text-[8px] text-muted-foreground">TWIN</span>;
      }
      case "dmBarcode": {
        const pos = anchorToObjectPosition(layout.dmBarcode?.sizeAnchor ?? "mc");
        return dmPreview
          ? <img src={dmPreview} alt="" className="w-full h-full object-contain pointer-events-none bg-white" style={{ objectPosition: pos }} />
          : <span className="text-[8px] text-muted-foreground">DM</span>;
      }
      case "signature": {
        const sUrl = cardPreview.signatureUrl || testSignatureUrl;
        const pos = anchorToObjectPosition(layout.signature?.sizeAnchor ?? "mc");
        return sUrl
          ? <img src={sUrl} alt="" className="w-full h-full object-contain pointer-events-none" style={{ objectPosition: pos }} />
          : <span className="text-[8px] text-muted-foreground">SIGN</span>;
      }
    }
  };

  // 오버레이 박스 자동 크기 계산용 (PDF/캔버스와 동일한 텍스트 매핑)
  const textForOverlay = (key: OptionKey): string => {
    if (!cardPreview) return "";
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>{side === "front" ? "카드 앞면" : "카드 뒷면"} 옵션 배치</span>
          <div className="flex items-center gap-3 text-xs font-normal">
            <span className="text-muted-foreground">실제 인쇄 크기 ({cardWmm.toFixed(1)}×{cardHmm.toFixed(1)}mm) · 저장된 카드 사이즈</span>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Switch checked={showGuide} onCheckedChange={setShowGuide} disabled={resultOnly} />
              <span className="text-muted-foreground">가이드 ({GUIDE_W_MM}×{GUIDE_H_MM}mm)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Switch checked={resultOnly} onCheckedChange={setResultOnly} />
              <span className="text-muted-foreground">결과물 미리보기</span>
            </label>
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
            {onSaveLayout && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saveBusy || saveDisabled}
                onClick={async () => {
                  setSaveBusy(true);
                  try { await onSaveLayout(); } finally { setSaveBusy(false); }
                }}
              >
                {saveBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                저장
              </Button>
            )}

          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          박스를 드래그해 이동하거나 오른쪽 아래 모서리를 끌어 크기를 조절하세요.
        </div>

        {/* Zoom controls */}
        <div className="flex items-center justify-center gap-2 text-xs">
          <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => clampZoom(z - 0.25))} title="축소"><ZoomOut className="h-3.5 w-3.5" /></Button>
          <input
            type="range"
            min={50}
            max={400}
            step={5}
            value={Math.round(zoom * 100)}
            onChange={e => setZoom(clampZoom(Number(e.target.value) / 100))}
            className="w-40 accent-primary"
          />
          <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => clampZoom(z + 0.25))} title="확대"><ZoomIn className="h-3.5 w-3.5" /></Button>
          <span className="tabular-nums w-12 text-center text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(1)} title="100%"><Maximize2 className="h-3.5 w-3.5" /></Button>
        </div>

        {/* Preview */}
        <div className="flex justify-center overflow-auto">
          <div
            style={{
              width: previewW * zoom,
              height: previewH * zoom,
            }}
          >
          <div
            style={{
              width: previewW,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
          <CardFrame
            ref={stageRef}
            className="border-2 rounded-md shadow-md"
            style={{
              width: previewW,
              aspectRatio: `${cardWmm} / ${cardHmm}`,
              background: "#fff",
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 500,
            }}
          >

            {/* 열전사 디자인 공장과 동일하게 PDF를 마스크 캔버스로 변환해 디자인을 먼저 합성합니다. */}
            {clippedPreview && !svgPreview && (
              <img
                src={clippedPreview}
                alt=""
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              />
            )}
            {svgPreview && (
              <img
                src={svgPreview.url}
                alt=""
                aria-hidden
                className="absolute pointer-events-none"
                style={{
                  left: ((cardWmm - svgPreview.wMm) / 2) * pxPerMm,
                  top: ((cardHmm - svgPreview.hMm) / 2) * pxPerMm,
                  width: svgPreview.wMm * pxPerMm,
                  height: svgPreview.hMm * pxPerMm,
                }}
              />
            )}
            {!clippedPreview && !svgPreview && (
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground pointer-events-none">
                테스트 이미지 또는 API 디자인이 없습니다
              </div>
            )}
            {showGuide && !resultOnly && (
              <div
                aria-hidden
                className="absolute pointer-events-none"
                style={{
                  left: guideLeftPx,
                  top: guideTopPx,
                  width: guideWpx,
                  height: guideHpx,
                  border: "1px solid #ef4444",
                  zIndex: 5,
                }}
              />
            )}
            {/* 기본 도형 옵션 미리보기 — 이미지 위, 텍스트 옵션 아래. 색상은 주문 데이터 아이콘 색상으로 재적용(backLine 제외). */}
            {(() => {
              const list: { s: ShapeOption; color: string | null }[] = side === "front"
                ? [
                    { s: shapeOptions?.frontOutline as ShapeOption, color: (cardPreview?.frontIconOuterColor || "").trim() || null },
                    { s: shapeOptions?.frontCenter  as ShapeOption, color: (cardPreview?.frontIconInnerColor || "").trim() || null },
                  ].filter(x => !!x.s)
                : [
                    { s: shapeOptions?.back     as ShapeOption, color: (cardPreview?.backIconColor || "").trim() || null },
                    { s: shapeOptions?.backLine as ShapeOption, color: null },
                  ].filter(x => !!x.s);
              return list.map(({ s, color }, i) => {
                if (!s?.svgDataUrl) return null;
                const rawSvg = decodeSvgDataUrl(s.svgDataUrl);
                if (!rawSvg) return null;
                const finalSvg = color ? recolorSvgString(rawSvg, color) : rawSvg;
                const nat = svgNaturalSizeMm(finalSvg);
                const tl = anchorTopLeft(s.x_mm, s.y_mm, nat.w, nat.h, s.anchor);
                const src = color
                  ? `data:image/svg+xml;utf8,${encodeURIComponent(finalSvg)}`
                  : s.svgDataUrl;
                return (
                  <img
                    key={`shape-${side}-${i}`}
                    src={src}
                    alt=""
                    aria-hidden
                    className="absolute pointer-events-none"
                    style={{
                      left: tl.left * pxPerMm,
                      top: tl.top * pxPerMm,
                      width: nat.w * pxPerMm,
                      height: nat.h * pxPerMm,
                    }}
                  />
                );
              });
            })()}

            {/* 텍스트 옵션이 그려지는 캔버스 — 도형 위 */}
            <canvas
              ref={previewCanvasRef}
              className="absolute inset-0 pointer-events-none"
              aria-hidden
            />


            {keys.map(key => {
              const cfg = layout[key];
              if (!cfg?.enabled) return null;
              const fontPx = (cfg.fontSize || 3) * pxPerMm;
              const isImage = isImageKey(key);
              const isSel = selected === key;
              const family = isImage ? "'Inter', system-ui, sans-serif" : getOptionFontCss(cfg);
              const weight = isImage ? 500 : getOptionFontWeight(cfg);
              // 텍스트 옵션은 글자에 맞춰 너비/높이 자동 산출, 이미지 옵션은 사용자 지정 cfg.w/h 사용
              // (X,Y)는 anchor 지점의 카드 내 좌표
              const effWmm = isImage ? cfg.w : measureTextWidthMm(textForOverlay(key), cfg.fontSize || 3, family, weight);
              const effHmm = isImage ? cfg.h : (cfg.fontSize || 3);
              const anc = getAnchor(key, cfg);
              const tl = anchorTopLeft(cfg.x, cfg.y, effWmm, effHmm, anc);
              const xMm = tl.left;
              const yMm = tl.top;
              const boxWpx = Math.max(effWmm * pxPerMm, isImage ? 0 : 4);
              const boxHpx = isImage ? cfg.h * pxPerMm : Math.max(fontPx, 4);
              // 결과물 미리보기 모드: 텍스트는 하단 캔버스가 이미 그리므로 오버레이 자체를 생략,
              // 이미지 옵션(TWIN/DM/서명)만 편집 chrome 없이 순수 콘텐츠로 렌더링한다.
              if (resultOnly && !isImage) return null;
              const chromeClass = resultOnly
                ? "absolute flex items-start justify-center overflow-visible pointer-events-none"
                : `absolute flex items-start justify-center text-foreground overflow-visible select-none ${
                    isSel ? "border-2 border-primary bg-primary/10 ring-2 ring-primary/30" : "border border-primary/60 bg-primary/5 hover:bg-primary/10"
                  }`;
              return (
                <div
                  key={key}
                  onPointerDown={resultOnly ? undefined : (e => startDrag(e, key, "move"))}
                  className={chromeClass}
                  style={{
                    left: xMm * pxPerMm,
                    top: yMm * pxPerMm,
                    width: boxWpx,
                    height: boxHpx,
                    fontSize: isImage ? undefined : fontPx,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    cursor: resultOnly ? "default" : "move",
                    background: key === "dmBarcode" ? "#fff" : undefined,
                    boxShadow: key === "dmBarcode" ? `0 0 0 ${(cfg.padding ?? 0) * pxPerMm}px #fff` : undefined,
                  }}
                  title={resultOnly ? undefined : `${OPTION_LABELS[key]} — 드래그로 이동`}
                >
                  {renderOptionPreview(key)}
                  {!resultOnly && (
                    <span className="absolute -top-4 left-0 text-[10px] bg-primary text-primary-foreground px-1 rounded-sm whitespace-nowrap pointer-events-none">
                      {OPTION_LABELS[key]}
                    </span>
                  )}
                  {!resultOnly && isImage && (
                    <span
                      onPointerDown={e => startDrag(e, key, "resize")}
                      className="absolute right-0 bottom-0 w-3 h-3 bg-primary cursor-se-resize"
                      title="크기 조절"
                    />
                  )}
                </div>
              );
            })}
          </CardFrame>
          </div>
          </div>
        </div>

        {/* Per-option controls */}
        <div className="space-y-2">
          {keys.map(key => {
            const cfg = layout[key];
            const isImage = isImageKey(key);
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
                <Mini label="X(mm)" v={cfg.x} set={v => update(key, { x: v })} />
                <Mini label="Y(mm)" v={cfg.y} set={v => update(key, { y: v })} />
                {key === "dmBarcode" ? (
                  <>
                    <Mini label="크기(mm)" v={cfg.w} set={v => update(key, { w: v, h: v })} />
                    <Mini label="여백(mm)" v={cfg.padding ?? 0} set={v => update(key, { padding: Math.max(0, v) })} step={0.1} />
                  </>
                ) : isImage ? (
                  <>
                    <Mini label="너비(mm)" v={cfg.w} set={v => {
                      if (cfg.lockAspect && cfg.w > 0 && cfg.h > 0) {
                        const ratio = cfg.h / cfg.w;
                        update(key, { w: v, h: Math.round(v * ratio * 10) / 10 });
                      } else {
                        update(key, { w: v });
                      }
                    }} />
                    <Mini label="높이(mm)" v={cfg.h} set={v => {
                      if (cfg.lockAspect && cfg.w > 0 && cfg.h > 0) {
                        const ratio = cfg.w / cfg.h;
                        update(key, { h: v, w: Math.round(v * ratio * 10) / 10 });
                      } else {
                        update(key, { h: v });
                      }
                    }} />
                  </>
                ) : (
                  // 텍스트 옵션: 너비/높이는 글자 크기에 자동 맞춤
                  <div className="md:col-span-2 text-[10px] text-muted-foreground self-end">
                    너비/높이 자동 (글자 크기 기준)
                  </div>
                )}
                {!isImage && (
                  <Mini label="글자(mm)" v={cfg.fontSize} set={v => update(key, { fontSize: v })} step={0.1} />
                )}
                <div className="md:col-span-2 flex items-center gap-2 flex-wrap">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap">기준점</Label>
                  <AnchorPicker value={getAnchor(key, cfg)} onChange={v => update(key, { anchor: v })} />
                  {(key === "twincode" || key === "dmBarcode" || key === "signature") && (
                    <>
                      <Label className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">크기 기준점</Label>
                      <AnchorPicker value={cfg.sizeAnchor ?? "mc"} onChange={v => update(key, { sizeAnchor: v })} />
                    </>
                  )}
                  {!isImage && (
                    <>
                      <Label className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">정렬</Label>
                      <AlignPicker value={getAlign(key, cfg)} onChange={v => update(key, { align: v })} />
                    </>
                  )}
                  {key === "signature" && (
                    <label className="flex items-center gap-1 cursor-pointer ml-2 text-[10px] text-muted-foreground">
                      <Checkbox checked={!!cfg.lockAspect} onCheckedChange={v => update(key, { lockAspect: !!v })} />
                      <span>비율 잠금</span>
                    </label>
                  )}
                </div>
                {!isImage && (
                  <div className="md:col-span-9 flex items-center gap-2 flex-wrap pt-1 border-t border-dashed mt-1" onClick={e => e.stopPropagation()}>
                    <Label className="text-[10px] text-muted-foreground whitespace-nowrap">글꼴</Label>
                    <select
                      value={getOptionFontId(cfg)}
                      onChange={e => update(key, { fontId: e.target.value })}
                      className="h-7 text-xs rounded border bg-background px-2"
                      style={{ fontFamily: getOptionFontCss(cfg), fontWeight: getOptionFontWeight(cfg) }}
                    >
                      {FONT_OPTIONS.map(f => (
                        <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>{f.label}</option>
                      ))}
                    </select>
                    <Label className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">BOLD</Label>
                    <select
                      value={getOptionFontWeight(cfg)}
                      onChange={e => update(key, { fontWeight: Number(e.target.value) })}
                      className="h-7 text-xs rounded border bg-background px-2"
                      style={{ fontFamily: getOptionFontCss(cfg), fontWeight: getOptionFontWeight(cfg) }}
                    >
                      {FONT_WEIGHTS.map(w => (
                        <option key={w.value} value={w.value} style={{ fontWeight: w.value }}>{w.label}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-muted-foreground ml-2">
                      미리보기:&nbsp;
                      <span style={{ fontFamily: getOptionFontCss(cfg), fontWeight: getOptionFontWeight(cfg), fontSize: 14 }}>
                        {textForOverlay(key) || "가나다 ABC 123"}
                      </span>
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">PDF는 Spoqa 폰트로 벡터 임베드(글꼴 선택은 미리보기 전용 · BOLD 강도는 PDF에도 반영)</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CroppedFrontThumb({ url, cardW, cardH }: { url: string; cardW: number; cardH: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const canvas = await composeMaskedCardCanvas(url, null, 320, 320 * (cardH / cardW));
        if (cancelled) return;
        setSrc(canvas.toDataURL("image/png"));
        const blob: Blob | null = await new Promise(res => canvas.toBlob(b => res(b), "image/png"));
        if (cancelled) return;
        if (blob) {
          createdUrl = URL.createObjectURL(blob);
          setBlobUrl(createdUrl);
        }
      } catch {
        if (!cancelled) setSrc(url);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url, cardW, cardH]);
  const href = blobUrl ?? url;
  const preview = src ?? url;
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!blobUrl) return;
    e.preventDefault();
    window.open(blobUrl, "_blank", "noopener,noreferrer");
  };
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
      <CardFrame widthClassName="w-8" className="border rounded">
        <img src={preview} alt="" className="w-full h-full object-cover" />
      </CardFrame>
    </a>
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

// 일러스트레이터 스타일 3×3 기준점 선택기
function AnchorPicker({ value, onChange }: { value: AnchorPoint; onChange: (v: AnchorPoint) => void }) {
  const rows: AnchorPoint[][] = [
    ["tl", "tc", "tr"],
    ["ml", "mc", "mr"],
    ["bl", "bc", "br"],
  ];
  return (
    <div
      className="inline-grid grid-cols-3 gap-0 border border-foreground/40 bg-background"
      style={{ width: 42, height: 42 }}
      role="radiogroup"
      aria-label="기준점 선택"
    >
      {rows.flat().map(p => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`기준점 ${p}`}
            onClick={e => { e.stopPropagation(); onChange(p); }}
            className="flex items-center justify-center hover:bg-primary/10 transition-colors"
            style={{ width: 14, height: 14 }}
          >
            <span
              className={active ? "bg-primary" : "bg-foreground/40"}
              style={{ width: 6, height: 6, borderRadius: 1 }}
            />
          </button>
        );
      })}
    </div>
  );
}

function AlignPicker({ value, onChange }: { value: TextAlign; onChange: (v: TextAlign) => void }) {
  const opts: { v: TextAlign; label: string; bars: number[] }[] = [
    { v: "left",   label: "왼쪽",   bars: [10, 7, 9] },
    { v: "center", label: "중앙",   bars: [10, 7, 9] },
    { v: "right",  label: "오른쪽", bars: [10, 7, 9] },
  ];
  return (
    <div className="inline-flex border border-foreground/40 bg-background rounded" role="radiogroup" aria-label="텍스트 정렬">
      {opts.map(o => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={e => { e.stopPropagation(); onChange(o.v); }}
            className={`flex flex-col items-end justify-center gap-[2px] px-2 py-1 transition-colors ${active ? "bg-primary/15" : "hover:bg-primary/10"}`}
            style={{ width: 22, height: 22, alignItems: o.v === "left" ? "flex-start" : o.v === "right" ? "flex-end" : "center" }}
          >
            {o.bars.map((w, i) => (
              <span key={i} className={active ? "bg-primary" : "bg-foreground/60"} style={{ width: w, height: 2, borderRadius: 1 }} />
            ))}
          </button>
        );
      })}
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

function ColorSwatch({ value }: { value: string }) {
  const v = (value || "").trim();
  if (!v) return <span className="text-xs text-muted-foreground">-</span>;
  const cssColor = /^#|^rgb|^hsl/i.test(v) ? v : v;
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block w-4 h-4 rounded border" style={{ background: cssColor }} />
      <span className="text-xs font-mono">{v}</span>
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

// ===== 발주 진행: 작업지시서 HTML / PDF 변환 / 스텝 UI / 썸네일 그리드 =====

function buildNfcWorkOrderHtml(wo: { company: string; orderNo: string; orderDate: string; deliveryDate: string; quantity: number; recipient: string; phone: string; address: string; notes: string; }) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>作业指示书 - ${esc(wo.orderNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif; color:#111; margin:0; padding:12mm; background:#fff; }
  h1 { font-size: 22pt; text-align:center; margin: 0 0 4mm; letter-spacing: 8px; border-bottom: 2px solid #111; padding-bottom: 4mm; }
  .meta { display:flex; justify-content:space-between; font-size: 9pt; color:#555; margin-bottom: 6mm; }
  table { width:100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 1px solid #333; padding: 2.5mm 3mm; vertical-align: middle; }
  th { background:#f2f2f2; font-weight:600; width: 22%; text-align:left; }
  .notes { min-height: 22mm; white-space: pre-wrap; }
  h2 { font-size: 12pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  .sig { margin-top: 10mm; display:flex; justify-content:flex-end; gap: 10mm; font-size: 10pt; }
  .sig div { border-top:1px solid #333; padding-top:2mm; min-width: 40mm; text-align:center; }
</style></head>
<body>
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
  <div class="sig"><div>负责人</div><div>审批</div></div>
</body></html>`;
}

async function renderHtmlToPdfBytesA4(html: string): Promise<Uint8Array> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "210mm";
  iframe.style.height = "297mm";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = html;
    });
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
    const x = (pageW - imgW) / 2;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", x, 0, imgW, imgH);
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    document.body.removeChild(iframe);
  }
}

function ProgressStep({ idx, label, done, disabled, onClick, busy }: { idx: number; label: string; done: boolean; disabled: boolean; onClick: () => void; busy?: boolean }) {
  return (
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
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <CheckCircle2 className="w-4 h-4" /> : idx}
        </div>
        <div className="font-medium text-sm">{label}</div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {busy ? "처리 중..." : done ? "완료" : disabled ? "이전 단계를 먼저 완료하세요" : "클릭하여 진행"}
      </div>
    </button>
  );
}

function CardThumbGrid({ cards, side, testImageUrl, backImagesByGrade }: { cards: CardData[]; side: "front" | "back"; testImageUrl: string | null; backImagesByGrade?: Record<CardGrade, TestAsset | null> }) {
  if (cards.length === 0) {
    return <div className="text-center text-sm text-muted-foreground py-12">카드가 없습니다</div>;
  }
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 p-1">
      {cards.map((c, i) => {
        const apiUrl = side === "front" ? c.frontImageUrl : c.backImageUrl;
        const gradeUrl = side === "back" && backImagesByGrade
          ? (backImagesByGrade[normalizeGrade(c.grade)]?.url || backImagesByGrade.COMMON?.url || null)
          : null;
        const src = apiUrl || gradeUrl || testImageUrl || null;
        return (
          <div key={`${c.uniqueNo}-${i}`} className="border rounded-md overflow-hidden bg-muted/20">
            <CardFrame widthClassName="w-full" className="bg-white">
              {src ? (
                <img src={src} alt={c.uniqueNo} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">
                  {side === "front" ? "앞면" : "뒷면"}
                </div>
              )}
            </CardFrame>
            <div className="px-1.5 py-1 border-t bg-background">
              <div className="text-[10px] font-mono truncate" title={c.uniqueNo}>{c.uniqueNo}</div>
              <div className="text-[9px] text-muted-foreground tabular-nums">#{c.seq}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// 기본 도형 옵션 카드 — 앞면(중심/외곽) + 뒷면(단일) SVG 업로드 및 위치/색상 설정
// SVG 원본 실제 크기를 사용하며, 카드 합성 시 이미지 위 레이어로 배치한다.
// 색상은 API 연동 전 테스트용 직접 입력 값(#RRGGBB)을 사용한다.
// ===========================================================================
const SvgAnchorPicker = ({
  val,
  onPick,
}: {
  val: ShapeAnchor;
  onPick: (a: ShapeAnchor) => void;
}) => {
  const anchors: ShapeAnchor[] = ["tl","tc","tr","ml","mc","mr","bl","bc","br"];
  return (
    <div className="flex flex-col items-center gap-1">
      <label className="text-[11px] text-muted-foreground">기준점</label>
      <div className="grid grid-cols-3 gap-[2px] p-0.5 rounded border bg-background">
        {anchors.map((a) => {
          const active = val === a;
          return (
            <button
              key={a}
              type="button"
              onClick={() => onPick(a)}
              className={cn(
                "w-3 h-3 rounded-full flex items-center justify-center transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 hover:bg-muted"
              )}
              title={a}
            >
              {active && <div className="w-1 h-1 rounded-full bg-primary-foreground" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};



const ShapeOptionRow = ({
  title,
  desc,
  k,
  s,
  update,
  onPickFile,
  positionReadOnly = false,
}: {
  title: string;
  desc: string;
  k: keyof ShapeOptions;
  s: ShapeOption;
  update: (key: keyof ShapeOptions, patch: Partial<ShapeOption>) => void;
  onPickFile: (key: keyof ShapeOptions, file: File | null) => void;
  positionReadOnly?: boolean;
}) => {
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-[11px] text-muted-foreground">{desc}</div>
        </div>
        {s.svgDataUrl && (
          <div className="h-10 w-10 rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
            <img src={s.svgDataUrl} alt={title} className="max-h-full max-w-full" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="file"
          accept=".svg,image/svg+xml"
          onChange={(e) => onPickFile(k, e.target.files?.[0] || null)}
          className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-input file:bg-background file:text-xs"
        />
        {s.fileName && (
          <button
            type="button"
            className="text-[11px] text-destructive underline"
            onClick={() => onPickFile(k, null)}
          >
            제거
          </button>
        )}
        {s.fileName && (
          <span className="text-[11px] text-muted-foreground truncate">{s.fileName}</span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 items-start">
        <div>
          <label className="text-[11px] text-muted-foreground">
            X (mm){positionReadOnly && <span className="ml-1 text-[10px]">· COMMON 동기화</span>}
          </label>
          <input
            type="number"
            step="0.001"
            value={s.x_mm}
            onChange={(e) => update(k, { x_mm: Number(e.target.value) })}
            readOnly={positionReadOnly}
            disabled={positionReadOnly}
            className={cn(
              "w-full h-8 rounded border bg-background px-2 text-xs",
              positionReadOnly && "bg-muted/50 cursor-not-allowed"
            )}
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">
            Y (mm){positionReadOnly && <span className="ml-1 text-[10px]">· COMMON 동기화</span>}
          </label>
          <input
            type="number"
            step="0.001"
            value={s.y_mm}
            onChange={(e) => update(k, { y_mm: Number(e.target.value) })}
            readOnly={positionReadOnly}
            disabled={positionReadOnly}
            className={cn(
              "w-full h-8 rounded border bg-background px-2 text-xs",
              positionReadOnly && "bg-muted/50 cursor-not-allowed"
            )}
          />
        </div>
        <SvgAnchorPicker val={s.anchor} onPick={(a) => update(k, { anchor: a })} />
      </div>
      <div className="text-[11px] text-muted-foreground">
        색상은 업로드한 SVG 파일의 원본 색상이 그대로 사용됩니다.
        {positionReadOnly && " · X/Y 위치는 COMMON 등급의 기본 도형 옵션 값을 사용합니다."}
      </div>
    </div>
  );
};

function ShapeOptionsCard({
  value,
  onChange,
  onSave,
  canSave,
  onOpenAdvanced,
}: {
  value: ShapeOptions;
  onChange: (next: ShapeOptions) => void;
  onSave?: () => Promise<void> | void;
  canSave?: boolean;
  onOpenAdvanced?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const update = (key: keyof ShapeOptions, patch: Partial<ShapeOption>) => {
    onChange({ ...value, [key]: { ...value[key], ...patch } });
  };

  const readSvgFile = async (file: File): Promise<string> => {
    const text = await file.text();
    // 간단한 검증 — <svg ...> 태그가 포함된 텍스트만 허용
    if (!/<svg[\s>]/i.test(text)) throw new Error("올바른 SVG 파일이 아닙니다");
    const b64 = btoa(unescape(encodeURIComponent(text)));
    return `data:image/svg+xml;base64,${b64}`;
  };

  const handleSave = async () => {
    if (!onSave) return;
    try {
      setSaving(true);
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  const onPickFile = async (key: keyof ShapeOptions, file: File | null) => {
    if (!file) { update(key, { svgDataUrl: null, fileName: null }); return; }
    try {
      const dataUrl = await readSvgFile(file);
      update(key, { svgDataUrl: dataUrl, fileName: file.name });
      // 업로드 직후 자동 저장 — 새로고침/재방문에도 파일이 유지되도록
      if (onSave && canSave !== false) {
        setTimeout(() => { void handleSave(); }, 0);
      }
    } catch (e: any) {
      alert(e?.message || "SVG 파일을 읽지 못했습니다");
    }
  };


  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            기본 도형 옵션
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">COMMON 등급</Badge>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-normal text-muted-foreground hidden md:inline">
              업로드한 파일은 저장 후 유지됩니다 · 변경/삭제 전까지 보존
            </span>
            {onOpenAdvanced && (
              <Button size="sm" variant="outline" onClick={onOpenAdvanced}>
                추가설정
              </Button>
            )}
            {onSave && (
              <Button size="sm" onClick={handleSave} disabled={saving || canSave === false}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                설정 저장
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ShapeOptionRow title="카드 앞면 · 중심 도형" desc="앞면 2개 도형 중 중심부 SVG" k="frontCenter" s={value.frontCenter} update={update} onPickFile={onPickFile} />
          <ShapeOptionRow title="카드 앞면 · 외곽 도형" desc="앞면 2개 도형 중 외곽부 SVG" k="frontOutline" s={value.frontOutline} update={update} onPickFile={onPickFile} />
          <ShapeOptionRow title="카드 뒷면 · 도형" desc="뒷면 단일 SVG" k="back" s={value.back} update={update} onPickFile={onPickFile} />
          <ShapeOptionRow title="카드 뒷면 · 라인" desc="뒷면 라인 SVG (원본 색상 유지)" k="backLine" s={value.backLine} update={update} onPickFile={onPickFile} />
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// 추가설정 페이지 — 등급(RARE/EPIC/LEGEND)별 기본 도형 SVG 업로드/위치 설정
// 기본(COMMON)은 상단의 "기본 도형 옵션" 카드가 담당하고,
// 여기서 등급별 오버라이드를 지정한다. 저장하지 않은 등급은 기본값으로 대체된다.
// ===========================================================================
function AdvancedShapeSettingsDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onSave,
  canSave,
  commonShapeOptions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: ShapeOptionsByGrade;
  onChange: (next: ShapeOptionsByGrade) => void;
  onSave?: () => Promise<void> | void;
  canSave?: boolean;
  commonShapeOptions: ShapeOptions;
}) {
  const [saving, setSaving] = useState(false);
  const [activeGrade, setActiveGrade] = useState<CardGrade>("RARE");

  const readSvgFile = async (file: File): Promise<string> => {
    const text = await file.text();
    if (!/<svg[\s>]/i.test(text)) throw new Error("올바른 SVG 파일이 아닙니다");
    const b64 = btoa(unescape(encodeURIComponent(text)));
    return `data:image/svg+xml;base64,${b64}`;
  };

  // COMMON 등급의 X/Y 좌표를 각 등급 도형에 강제 동기화
  const syncCommonPosition = (opts: ShapeOptions): ShapeOptions => {
    const keys: (keyof ShapeOptions)[] = ["frontCenter", "frontOutline", "back", "backLine"];
    const next: ShapeOptions = { ...opts };
    keys.forEach((k) => {
      next[k] = { ...opts[k], x_mm: commonShapeOptions[k].x_mm, y_mm: commonShapeOptions[k].y_mm };
    });
    return next;
  };

  const forGrade = (g: CardGrade): ShapeOptions =>
    syncCommonPosition(value[g] || cloneDefaultShapeOptions());

  const updateGrade = (g: CardGrade, key: keyof ShapeOptions, patch: Partial<ShapeOption>) => {
    const cur = value[g] || cloneDefaultShapeOptions();
    // X/Y 좌표는 COMMON 값을 우선으로 사용 — 등급별 수정 불가
    const { x_mm: _x, y_mm: _y, ...safePatch } = patch;
    const merged: ShapeOption = {
      ...cur[key],
      ...safePatch,
      x_mm: commonShapeOptions[key].x_mm,
      y_mm: commonShapeOptions[key].y_mm,
    };
    const next: ShapeOptions = { ...cur, [key]: merged };
    onChange({ ...value, [g]: next });
  };

  // COMMON X/Y가 바뀌면 저장된 등급별 데이터도 즉시 동기화
  useEffect(() => {
    if (!open) return;
    let changed = false;
    const nextAll: ShapeOptionsByGrade = { ...value };
    (CARD_GRADES_ADVANCED as CardGrade[]).forEach((g) => {
      const cur = value[g];
      if (!cur) return;
      const synced = syncCommonPosition(cur);
      const keys: (keyof ShapeOptions)[] = ["frontCenter", "frontOutline", "back", "backLine"];
      const diff = keys.some(
        (k) => cur[k].x_mm !== synced[k].x_mm || cur[k].y_mm !== synced[k].y_mm
      );
      if (diff) {
        nextAll[g] = synced;
        changed = true;
      }
    });
    if (changed) onChange(nextAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, commonShapeOptions.frontCenter.x_mm, commonShapeOptions.frontCenter.y_mm,
      commonShapeOptions.frontOutline.x_mm, commonShapeOptions.frontOutline.y_mm,
      commonShapeOptions.back.x_mm, commonShapeOptions.back.y_mm,
      commonShapeOptions.backLine.x_mm, commonShapeOptions.backLine.y_mm]);


  const handleSave = async () => {
    if (!onSave) return;
    try {
      setSaving(true);
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  const onPickFile = async (g: CardGrade, key: keyof ShapeOptions, file: File | null) => {
    if (!file) { updateGrade(g, key, { svgDataUrl: null, fileName: null }); return; }
    try {
      const dataUrl = await readSvgFile(file);
      updateGrade(g, key, { svgDataUrl: dataUrl, fileName: file.name });
      if (onSave && canSave !== false) {
        setTimeout(() => { void handleSave(); }, 0);
      }
    } catch (e: any) {
      alert(e?.message || "SVG 파일을 읽지 못했습니다");
    }
  };

  const resetGrade = (g: CardGrade) => {
    if (!confirm(`${GRADE_LABEL[g]} 등급 도형 설정을 초기화하시겠습니까?`)) return;
    onChange({ ...value, [g]: cloneDefaultShapeOptions() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>등급별 기본 도형 추가설정</span>
            <span className="text-xs font-normal text-muted-foreground">
              등급별로 앞면 중심/외곽 · 뒷면 도형/라인 SVG를 지정합니다. 등급별 값이 있으면 우선 적용됩니다.
            </span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeGrade} onValueChange={(v) => setActiveGrade(v as CardGrade)}>
          <TabsList>
            {CARD_GRADES_ADVANCED.map((g) => (
              <TabsTrigger key={g} value={g}>{GRADE_LABEL[g]}</TabsTrigger>
            ))}
          </TabsList>

          {CARD_GRADES_ADVANCED.map((g) => {
            const s = forGrade(g);
            const update = (key: keyof ShapeOptions, patch: Partial<ShapeOption>) =>
              updateGrade(g, key, patch);
            const pick = (key: keyof ShapeOptions, file: File | null) =>
              onPickFile(g, key, file);
            return (
              <TabsContent key={g} value={g} className="pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-muted-foreground">
                    <Badge variant="outline" className="mr-2">{GRADE_LABEL[g]}</Badge>
                    등급 도형 설정
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => resetGrade(g)}>초기화</Button>
                    {onSave && (
                      <Button size="sm" onClick={handleSave} disabled={saving || canSave === false}>
                        {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                        설정 저장
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <ShapeOptionRow title="카드 앞면 · 중심 도형" desc="앞면 2개 도형 중 중심부 SVG" k="frontCenter" s={s.frontCenter} update={update} onPickFile={pick} positionReadOnly />
                  <ShapeOptionRow title="카드 앞면 · 외곽 도형" desc="앞면 2개 도형 중 외곽부 SVG" k="frontOutline" s={s.frontOutline} update={update} onPickFile={pick} positionReadOnly />
                  <ShapeOptionRow title="카드 뒷면 · 도형" desc="뒷면 단일 SVG" k="back" s={s.back} update={update} onPickFile={pick} positionReadOnly />
                  <ShapeOptionRow title="카드 뒷면 · 라인" desc="뒷면 라인 SVG (원본 색상 유지)" k="backLine" s={s.backLine} update={update} onPickFile={pick} positionReadOnly />
                </div>
              </TabsContent>
            );
          })}
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// 등급별 뒷면 이미지 업로드 다이얼로그
// ===========================================================================
function BackImagesByGradeDialog({
  open,
  onOpenChange,
  images,
  onUpload,
  cardSize,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  images: Record<CardGrade, TestAsset | null>;
  onUpload: (grade: CardGrade, file: File | null) => void | Promise<void>;
  cardSize: CardSize;
}) {
  const grades: CardGrade[] = ["COMMON", "RARE", "EPIC", "LEGEND"];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>등급별 뒷면 이미지 설정</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-2">
          각 등급별로 카드 뒷면 배경 이미지를 업로드하세요. 실제 주문 이미지가 있는 카드는 그 이미지가 우선 적용됩니다.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[70vh] overflow-auto">
          {grades.map(g => {
            const asset = images[g];
            return (
              <div key={g} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-mono text-xs font-medium">{g}</Label>
                  {asset && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600">서버 저장됨</span>
                  )}
                </div>
                <div className="flex justify-center">
                  <TestDesignThumb cardSize={cardSize} imageUrl={asset?.url ?? null} />
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {asset?.name || "미설정"}
                </div>
                <div className="flex gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 cursor-pointer text-xs px-3 py-2 border border-dashed rounded hover:bg-accent">
                    <Upload className="w-3 h-3" />
                    <span>{asset ? "변경" : "이미지 업로드"}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg,application/pdf" className="hidden"
                      onChange={e => { const f = e.target.files?.[0] || null; e.currentTarget.value = ""; if (f) onUpload(g, f); }} />
                  </label>
                  {asset && (
                    <Button size="sm" variant="destructive" className="text-xs"
                      onClick={() => { if (confirm(`${g} 등급 뒷면 이미지를 삭제할까요?`)) onUpload(g, null); }}>
                      <X className="w-3 h-3 mr-1" />삭제
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== Composited card thumbnail (design + shapes + text overlays) ==============
function CardCompositeThumb({
  side, card, cardSize, testImageUrl, testTwincodeUrl, testSignatureUrl,
  layout, keys, backDefaults, shapeOptions, width,
}: {
  side: "front" | "back";
  card: CardData;
  cardSize: CardSize;
  testImageUrl?: string | null;
  testTwincodeUrl?: string | null;
  testSignatureUrl?: string | null;
  layout: Record<OptionKey, OptionLayout>;
  keys: OptionKey[];
  backDefaults?: { companyName: string; centerSlogan: string; nfcEnabled: string; issuedBy: string };
  shapeOptions?: ShapeOptions;
  width: number;
}) {
  const cardWmm = cardSize.width;
  const cardHmm = cardSize.height;
  const pxPerMm = width / cardWmm;
  const height = cardHmm * pxPerMm;
  const designUrl = (side === "front" ? card?.frontImageUrl : card?.backImageUrl) || testImageUrl || null;

  const shapes = side === "front"
    ? [
        { s: shapeOptions?.frontOutline as ShapeOption | undefined, color: (card?.frontIconOuterColor || "").trim() || null },
        { s: shapeOptions?.frontCenter  as ShapeOption | undefined, color: (card?.frontIconInnerColor || "").trim() || null },
      ]
    : [
        { s: shapeOptions?.back     as ShapeOption | undefined, color: (card?.backIconColor || "").trim() || null },
        { s: shapeOptions?.backLine as ShapeOption | undefined, color: null },
      ];

  const textFor = (key: OptionKey): string => {
    if (!card) return "";
    switch (key) {
      case "cpValue":   return card.cpValue || "-";
      case "editionNo": return card.editionNo || "";
      case "issuedNo":  return `ISSUED No. ${card.issuedNo || ""}`;
      case "mintedOn":  return `Minted on ${card.mintedOn || ""}`;
      case "grade":     return card.grade || "";
      case "companyName":  return backDefaults?.companyName || "";
      case "centerSlogan": return backDefaults?.centerSlogan || "";
      case "nfcEnabled":   return backDefaults?.nfcEnabled || "";
      case "issuedBy":     return backDefaults?.issuedBy || "";
      default: return "";
    }
  };

  const imageSrcFor = (key: OptionKey): string | null => {
    if (key === "twincode") return card?.twincodeSvgUrl || testTwincodeUrl || null;
    if (key === "signature") return card?.signatureUrl || testSignatureUrl || null;
    return null;
  };

  return (
    <div
      className="relative border rounded overflow-hidden bg-white shrink-0"
      style={{ width, height }}
    >
      {designUrl && (
        <img src={designUrl} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
      )}
      {shapes.map(({ s, color }, i) => {
        if (!s?.svgDataUrl) return null;
        const raw = decodeSvgDataUrl(s.svgDataUrl);
        if (!raw) return null;
        const finalSvg = color ? recolorSvgString(raw, color) : raw;
        const nat = svgNaturalSizeMm(finalSvg);
        const tl = anchorTopLeft(s.x_mm, s.y_mm, nat.w, nat.h, s.anchor);
        const src = color ? `data:image/svg+xml;utf8,${encodeURIComponent(finalSvg)}` : s.svgDataUrl;
        return (
          <img
            key={`shape-${i}`}
            src={src}
            alt=""
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              left: tl.left * pxPerMm,
              top: tl.top * pxPerMm,
              width: nat.w * pxPerMm,
              height: nat.h * pxPerMm,
            }}
          />
        );
      })}
      {keys.map(key => {
        const cfg = layout[key];
        if (!cfg?.enabled) return null;
        if (key === "dmBarcode") {
          const anc = getAnchor(key, cfg);
          const tl = anchorTopLeft(cfg.x, cfg.y, cfg.w, cfg.h, anc);
          const pad = (cfg.padding ?? 0) * pxPerMm;
          return (
            <div
              key={key}
              className="absolute pointer-events-none bg-white"
              style={{
                left: tl.left * pxPerMm,
                top: tl.top * pxPerMm,
                width: cfg.w * pxPerMm,
                height: cfg.h * pxPerMm,
                padding: pad,
              }}
            >
              <DmBarcodeOverlay text={card?.uniqueNo || ""} />
            </div>
          );
        }
        if (isImageKey(key)) {
          const src = imageSrcFor(key);
          if (!src) return null;
          const anc = getAnchor(key, cfg);
          const tl = anchorTopLeft(cfg.x, cfg.y, cfg.w, cfg.h, anc);
          return (
            <img
              key={key}
              src={src}
              alt=""
              className="absolute pointer-events-none object-contain"
              style={{
                left: tl.left * pxPerMm,
                top: tl.top * pxPerMm,
                width: cfg.w * pxPerMm,
                height: cfg.h * pxPerMm,
              }}
            />
          );
}

// Small overlay that generates and renders a DataMatrix barcode PNG, filling its parent.
function DmBarcodeOverlay({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!text) { setSrc(null); return; }
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const bytes = await dataMatrixPngBytes(text, 200);
        if (cancelled) return;
        const blob = new Blob([bytes as BlobPart], { type: "image/png" });
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch {}
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [text]);
  return src
    ? <img src={src} alt="" className="w-full h-full object-contain" />
    : null;
}
        const text = textFor(key);
        if (!text) return null;
        const fontPx = (cfg.fontSize || 3) * pxPerMm;
        const family = getOptionFontCss(cfg);
        const weight = getOptionFontWeight(cfg);
        const anc = getAnchor(key, cfg);
        const tx = anc.endsWith("c") ? "translateX(-50%)" : anc.endsWith("r") ? "translateX(-100%)" : "";
        const ty = anc.startsWith("m") ? "translateY(-50%)" : anc.startsWith("b") ? "translateY(-100%)" : "";
        return (
          <div
            key={key}
            className="absolute whitespace-nowrap pointer-events-none"
            style={{
              left: cfg.x * pxPerMm,
              top: cfg.y * pxPerMm,
              fontSize: fontPx,
              fontFamily: family,
              fontWeight: weight,
              color: "#000",
              lineHeight: 1,
              transform: `${tx} ${ty}`.trim() || undefined,
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}

// Clickable table cell: small composite thumb + dialog with larger preview
function CardPreviewCell(props: Omit<React.ComponentProps<typeof CardCompositeThumb>, "width">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block hover:opacity-80 transition-opacity"
        title="클릭하여 크게 보기"
      >
        <CardCompositeThumb {...props} width={48} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {props.side === "front" ? "카드 앞면" : "카드 뒷면"} 미리보기 · <span className="font-mono text-sm">{props.card.uniqueNo}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <CardCompositeThumb {...props} width={360} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


