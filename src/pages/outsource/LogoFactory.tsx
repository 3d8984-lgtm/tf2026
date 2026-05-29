import { useMemo, useState, useEffect, useRef } from "react";
import PageHeader from "@/components/PageHeader";
import { useOrders } from "@/hooks/useDbData";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Eye, ImageOff, ChevronLeft, FileText, Download, Sparkles, Upload, Trash2, Cloud } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { supabase } from "@/integrations/supabase/client";
import { VECTORIZER_MODE_KEY } from "./OutsourceSettings";

function fmtDate(v?: string | null): string {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v).slice(0, 10); }
}

interface OrderRow {
  orderNo: string;
  receivedAt: string;
  dueDate: string;
  recipient: string;
  logoUrl: string | null;
  quantity: number;
}

type WorkType = "heat-transfer" | "hologram" | "laser" | "embroidery" | "print";
const WORK_TYPES: { value: WorkType; label: string }[] = [
  { value: "heat-transfer", label: "열전사" },
  { value: "hologram", label: "홀로그램" },
  { value: "laser", label: "레이저" },
  { value: "embroidery", label: "자수" },
  { value: "print", label: "인쇄" },
];

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 로드 실패"));
    img.src = src;
  });
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

function svgDataUrlToText(dataUrl: string): string {
  const utf8Prefix = "data:image/svg+xml;utf8,";
  if (dataUrl.startsWith(utf8Prefix)) return decodeURIComponent(dataUrl.slice(utf8Prefix.length));

  const base64Prefix = "data:image/svg+xml;base64,";
  if (dataUrl.startsWith(base64Prefix)) return atob(dataUrl.slice(base64Prefix.length));

  return dataUrl;
}

/**
 * Edge-preserving sharp upscale for logo / text / icon / line-art images.
 *
 * Strategy (NO photo-style smoothing, NO AI re-draw):
 *  1. Iterative 2× bilinear upscale (high quality) until the image is at-or-above target.
 *     Step-wise 2× preserves edges far better than a single large bicubic jump.
 *  2. Final fit to exact target size with high-quality resampling.
 *  3. Unsharp-mask on RGB only to restore edge crispness lost during resampling.
 *  4. Alpha channel is kept untouched (preserves transparent background).
 *     If the source alpha is binary-ish, edges are re-thresholded to avoid
 *     soft halos around logos.
 *  5. Tiny low-contrast noise is suppressed without touching strong edges.
 *
 * The function never invents new detail; it only resamples and re-sharpens
 * what is already in the source image.
 */
function edgePreservingUpscale(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
): HTMLCanvasElement {
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  if (srcW === 0 || srcH === 0) throw new Error("이미지 크기가 0입니다");

  // Step 1+2: iterative 2× upscale then final fit.
  let canvas = document.createElement("canvas");
  canvas.width = srcW;
  canvas.height = srcH;
  let ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  while (canvas.width * 2 <= targetW && canvas.height * 2 <= targetH) {
    const next = document.createElement("canvas");
    next.width = canvas.width * 2;
    next.height = canvas.height * 2;
    const nctx = next.getContext("2d")!;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }

  if (canvas.width !== targetW || canvas.height !== targetH) {
    const final = document.createElement("canvas");
    final.width = targetW;
    final.height = targetH;
    const fctx = final.getContext("2d")!;
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = "high";
    fctx.drawImage(canvas, 0, 0, targetW, targetH);
    canvas = final;
  }

  ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const W = canvas.width;
  const H = canvas.height;
  const imgData = ctx.getImageData(0, 0, W, H);
  const px = imgData.data;
  const N = W * H;

  // ----- Detect whether source alpha is binary-ish (logo with transparency).
  // Sample original pixels (before resample) to decide thresholding policy.
  let srcBinaryAlpha = false;
  let srcHasAlpha = false;
  try {
    const sc = document.createElement("canvas");
    sc.width = srcW;
    sc.height = srcH;
    const sctx = sc.getContext("2d")!;
    sctx.drawImage(img, 0, 0);
    const sd = sctx.getImageData(0, 0, srcW, srcH).data;
    let mid = 0;
    let edge = 0;
    for (let i = 3; i < sd.length; i += 4) {
      const a = sd[i];
      if (a > 0 && a < 255) {
        if (a > 24 && a < 232) mid++;
        else edge++;
      } else if (a === 0) {
        srcHasAlpha = true;
      }
    }
    if (srcHasAlpha || mid + edge > 0) srcHasAlpha = srcHasAlpha || mid + edge > 0;
    // Binary-ish: many fully-on/off, few mid-tones
    srcBinaryAlpha = srcHasAlpha && mid * 8 < edge + 1;
  } catch {
    /* tainted canvas — skip detection */
  }

  // ----- Step 3: Unsharp mask on RGB. Alpha is untouched.
  // Build a 3×3 box-blur as the "blurred" copy, then sharpen = orig + amount*(orig - blur).
  const blurred = new Uint8ClampedArray(px.length);
  // Edge rows/cols: copy directly to avoid out-of-bounds.
  blurred.set(px);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        // 3×3 box
        sum += px[idx - W * 4 - 4 + c];
        sum += px[idx - W * 4 + c];
        sum += px[idx - W * 4 + 4 + c];
        sum += px[idx - 4 + c];
        sum += px[idx + c];
        sum += px[idx + 4 + c];
        sum += px[idx + W * 4 - 4 + c];
        sum += px[idx + W * 4 + c];
        sum += px[idx + W * 4 + 4 + c];
        blurred[idx + c] = sum / 9;
      }
    }
  }

  // Sharpen amount tuned for logo / line-art (strong but not ringing).
  const AMOUNT = 0.85;
  // Threshold: skip very small differences to avoid amplifying compression noise.
  const NOISE_THRESH = 4;
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = px[i + c];
      const b = blurred[i + c];
      const d = o - b;
      if (d > -NOISE_THRESH && d < NOISE_THRESH) continue;
      const v = o + AMOUNT * d;
      px[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }

  // ----- Step 4: Alpha cleanup for transparent-background logos.
  // If the source had a clean binary alpha, restore hard edges so the upscaled
  // result does not show a soft halo around the logo.
  if (srcBinaryAlpha) {
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i];
      if (a < 24) px[i] = 0;
      else if (a > 232) px[i] = 255;
      // mid-tones (true anti-alias) left alone
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** Convert mm + dpi → integer pixel count. */
function mmToPx(mm: number, dpi: number): number {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

/** Rasterize an SVG data URL at an exact target size, preserving transparency. */
async function rasterizeSvgAt(svgDataUrl: string, targetW: number, targetH: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(svgDataUrl);
  const c = document.createElement("canvas");
  c.width = targetW;
  c.height = targetH;
  const cx = c.getContext("2d")!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(img, 0, 0, targetW, targetH);
  return c;
}

export default function LogoFactory() {
  const { t } = useLang();
  const { data: ordersData, isLoading } = useOrders();
  const [detailOrderNo, setDetailOrderNo] = useState<string | null>(null);

  const rows: OrderRow[] = useMemo(() => {
    if (!ordersData) return [];
    return (ordersData as any[])
      .map(o => ({
        orderNo: o.external_order_id,
        receivedAt: fmtDate(o.created_at),
        dueDate: fmtDate(o.project_completed_at),
        recipient: o.recipient_name || "",
        logoUrl: o.logo_url || null,
        quantity: o.quantity || 0,
      }))
      .sort((a, b) => a.orderNo.localeCompare(b.orderNo));
  }, [ordersData]);

  const detailOrder = useMemo(() => {
    if (!detailOrderNo || !ordersData) return null;
    return (ordersData as any[]).find(o => o.external_order_id === detailOrderNo) || null;
  }, [detailOrderNo, ordersData]);

  if (detailOrderNo && detailOrder) {
    return (
      <LogoDetailView
        order={detailOrder}
        onBack={() => setDetailOrderNo(null)}
      />
    );
  }

  return (
    <div>
      <PageHeader title={t("menu.outLogo")} description="작업번호별 로고 외주 발주 관리" />
      <div className="p-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">주문 목록</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>작업번호</TableHead>
                  <TableHead>주문접수일</TableHead>
                  <TableHead>납기일</TableHead>
                  <TableHead>트윈커</TableHead>
                  <TableHead>로고</TableHead>
                  <TableHead className="text-right">작업수량</TableHead>
                  <TableHead className="text-right">상세보기</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">로딩 중...</TableCell></TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">주문 데이터가 없습니다</TableCell></TableRow>
                )}
                {rows.map((r, i) => (
                  <TableRow key={r.orderNo}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono">{r.orderNo}</TableCell>
                    <TableCell>{r.receivedAt}</TableCell>
                    <TableCell>{r.dueDate || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>{r.recipient}</TableCell>
                    <TableCell>
                      <div className="w-12 h-12 rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
                        {r.logoUrl ? (
                          <img src={r.logoUrl} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                        ) : (
                          <ImageOff className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </TableCell>
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

/* ============================== Detail View ============================== */

function LogoDetailView({ order, onBack }: { order: any; onBack: () => void }) {
  const orderNo: string = order.external_order_id;
  const qty: number = order.quantity || 0;
  const surplus = Math.ceil(qty * 0.05);
  const total = qty + surplus;
  const logoUrl: string | null = order.logo_url || null;

  // Work order (작업지시서)
  const WO_LS_KEY = `logo.workOrder.v1.${orderNo}`;
  const woDefaults = useMemo(() => ({
    company: "TWINMETA",
    orderNo,
    orderDate: fmtDate(order?.created_at),
    deliveryDate: fmtDate(order?.project_completed_at),
    baseQty: qty,
    surplusQty: surplus,
    totalQty: total,
    recipient: "TWINMETA",
    phone: "18562757070",
    address: "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
    notes: order?.source_data?.notes || order?.source_data?.special_notes || "",
  }), [orderNo, order, qty, surplus, total]);

  const [wo, setWo] = useState(woDefaults);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WO_LS_KEY);
      if (raw) setWo({ ...woDefaults, ...JSON.parse(raw) });
      else setWo(woDefaults);
    } catch { setWo(woDefaults); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo]);
  const setWoP = (p: Partial<typeof wo>) => setWo(prev => ({ ...prev, ...p }));

  // Logo settings
  const [workType, setWorkType] = useState<WorkType>("heat-transfer");
  const DEFAULT_BASE_MM = 50;
  const DEFAULT_CANVAS_MM = 100;
  const [canvasWidthMm, setCanvasWidthMm] = useState<number>(DEFAULT_CANVAS_MM);
  const [canvasHeightMm, setCanvasHeightMm] = useState<number>(DEFAULT_CANVAS_MM);
  const [logoWidthMm, setLogoWidthMm] = useState<number>(DEFAULT_BASE_MM);
  const [logoHeightMm, setLogoHeightMm] = useState<number>(DEFAULT_BASE_MM);
  const [offsetXMm, setOffsetXMm] = useState<number>(0);
  const [offsetYMm, setOffsetYMm] = useState<number>(0);
  const [lockAspect, setLockAspect] = useState<boolean>(true);
  const [naturalAspect, setNaturalAspect] = useState<number>(1); // width / height
  const [processedDataUrl, setProcessedDataUrl] = useState<string | null>(null); // upscaled or vectorized
  const [processedKind, setProcessedKind] = useState<"original" | "upscaled" | "vector">("original");
  const [testLogoDataUrl, setTestLogoDataUrl] = useState<string | null>(null);
  const [testLogoName, setTestLogoName] = useState<string | null>(null);
  const testLogoInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Compare viewer
  const [compareMode, setCompareMode] = useState<"side" | "slider">("side");
  const [compareZoom, setCompareZoom] = useState<number>(3);
  const [compareOrigin, setCompareOrigin] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [sliderPct, setSliderPct] = useState<number>(50);
  const [compareBg, setCompareBg] = useState<"checker" | "white" | "black">("checker");
  const [compareTarget, setCompareTarget] = useState<"upscaled" | "vector">("vector");
  // Persist each processed result independently so the comparator can switch between them.
  const [upscaledDataUrl, setUpscaledDataUrl] = useState<string | null>(null);
  const [vectorDataUrl, setVectorDataUrl] = useState<string | null>(null);

  // Logo size as % of canvas longest side — convenience slider
  const canvasLongest = Math.max(canvasWidthMm, canvasHeightMm) || 1;
  const logoLongest = Math.max(logoWidthMm, logoHeightMm) || 0;
  const logoScalePct = Math.min(100, Math.round((logoLongest / canvasLongest) * 100));

  const setLogoScalePct = (pct: number) => {
    const p = Math.max(1, Math.min(100, pct));
    const longest = (canvasLongest * p) / 100;
    const ar = naturalAspect || 1;
    if (ar >= 1) {
      const w = Math.round(longest * 10) / 10;
      setLogoWidthMm(w);
      setLogoHeightMm(Math.round((w / ar) * 10) / 10);
    } else {
      const h = Math.round(longest * 10) / 10;
      setLogoHeightMm(h);
      setLogoWidthMm(Math.round(h * ar * 10) / 10);
    }
  };

  // Clamp offsets so the logo stays within the canvas
  const maxOffsetX = Math.max(0, (canvasWidthMm - logoWidthMm) / 2);
  const maxOffsetY = Math.max(0, (canvasHeightMm - logoHeightMm) / 2);
  const clampedOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, offsetXMm));
  const clampedOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, offsetYMm));

  useEffect(() => {
    setProcessedDataUrl(null);
    setProcessedKind("original");
    setUpscaledDataUrl(null);
    setVectorDataUrl(null);
    setTestLogoDataUrl(null);
    setTestLogoName(null);
  }, [logoUrl]);

  // Auto-set default print size based on source logo's natural aspect ratio.
  // Base = 50mm on the longer side; the shorter side scales proportionally.
  useEffect(() => {
    const src = testLogoDataUrl || logoUrl;
    if (!src) return;
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = src.startsWith("data:") ? src : await fetchAsDataUrl(src);
        const img = await loadImage(dataUrl);
        if (cancelled) return;
        const ar = img.naturalWidth / img.naturalHeight;
        setNaturalAspect(ar || 1);
        if (ar >= 1) {
          setLogoWidthMm(DEFAULT_BASE_MM);
          setLogoHeightMm(Math.round((DEFAULT_BASE_MM / ar) * 10) / 10);
        } else {
          setLogoHeightMm(DEFAULT_BASE_MM);
          setLogoWidthMm(Math.round(DEFAULT_BASE_MM * ar * 10) / 10);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [logoUrl, testLogoDataUrl]);

  const handleWidthChange = (v: number) => {
    setLogoWidthMm(v);
    if (lockAspect && naturalAspect > 0) {
      setLogoHeightMm(Math.round((v / naturalAspect) * 10) / 10);
    }
  };
  const handleHeightChange = (v: number) => {
    setLogoHeightMm(v);
    if (lockAspect && naturalAspect > 0) {
      setLogoWidthMm(Math.round(v * naturalAspect * 10) / 10);
    }
  };

  // Test logo overrides API logo as the source; processed result overrides both for display
  const sourceLogo = testLogoDataUrl || logoUrl;
  const displayedLogo = processedDataUrl || sourceLogo;

  const handleTestLogoSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "이미지 파일만 업로드 가능합니다", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setTestLogoDataUrl(reader.result as string);
      setTestLogoName(file.name);
      setProcessedDataUrl(null);
      setProcessedKind("original");
      setUpscaledDataUrl(null);
      setVectorDataUrl(null);
      toast({ title: "테스트 로고 적용됨", description: file.name });
    };
    reader.onerror = () => toast({ title: "파일 읽기 실패", variant: "destructive" });
    reader.readAsDataURL(file);
  };

  const handleRemoveTestLogo = () => {
    setTestLogoDataUrl(null);
    setTestLogoName(null);
    setProcessedDataUrl(null);
    setProcessedKind("original");
    setUpscaledDataUrl(null);
    setVectorDataUrl(null);
    if (testLogoInputRef.current) testLogoInputRef.current.value = "";
    toast({ title: "테스트 로고 제거됨", description: "원본 로고로 복원되었습니다" });
  };

  const handleUpscale = async () => {
    if (!sourceLogo) return;
    setBusy("로고 업스케일링 중 (edge-preserving)...");
    try {
      const src = sourceLogo!;
      const dataUrl = src.startsWith("data:") ? src : await fetchAsDataUrl(src);

      // Edge-preserving 2x upscale (local)
      const img = await loadImage(dataUrl);
      const targetW = img.naturalWidth * 2;
      const targetH = img.naturalHeight * 2;
      const canvas = edgePreservingUpscale(img, targetW, targetH);
      const up = canvas.toDataURL("image/png");
      setUpscaledDataUrl(up);
      setProcessedDataUrl(up);
      setProcessedKind("upscaled");
      setCompareTarget("upscaled");
      toast({
        title: "업스케일 완료",
        description: `${img.naturalWidth}×${img.naturalHeight} → ${canvas.width}×${canvas.height} · edge-preserving`,
      });
    } catch (e: any) {
      toast({ title: "업스케일 실패", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };


  /**
   * Generate a print-ready PNG at the requested DPI and trigger download.
   * - If a vector (SVG) result exists, rasterizes the SVG directly at the
   *   exact target size — perfectly crisp, no upscaling artifacts.
   * - Otherwise runs edge-preserving sharp upscale from the source image.
   * - Transparent background is preserved (PNG with alpha).
   */
  const downloadPrintPng = async (dpi: 300 | 600) => {
    if (!sourceLogo) {
      toast({ title: "로고가 없습니다", variant: "destructive" });
      return;
    }
    if (!logoWidthMm || !logoHeightMm) {
      toast({ title: "출력 크기(mm)를 먼저 입력하세요", variant: "destructive" });
      return;
    }
    if (!canvasWidthMm || !canvasHeightMm) {
      toast({ title: "인쇄영역(mm)을 먼저 입력하세요", variant: "destructive" });
      return;
    }
    setBusy(`PNG ${dpi}dpi 생성 중...`);
    try {
      // Output PNG = logo size only (matches print width × height in mm)
      const logoW = mmToPx(logoWidthMm, dpi);
      const logoH = mmToPx(logoHeightMm, dpi);

      // Rasterize the source (vector preferred) at the exact logo target size
      let logoCanvas: HTMLCanvasElement;
      let modeLabel: string;
      if (vectorDataUrl && processedKind === "vector") {
        logoCanvas = await rasterizeSvgAt(vectorDataUrl, logoW, logoH);
        modeLabel = "벡터 래스터화";
      } else {
        const src = (processedKind === "upscaled" && upscaledDataUrl) ? upscaledDataUrl : sourceLogo!;
        const dataUrl = src.startsWith("data:") ? src : await fetchAsDataUrl(src);
        const img = await loadImage(dataUrl);
        logoCanvas = edgePreservingUpscale(img, logoW, logoH);
        modeLabel = (processedKind === "upscaled" && upscaledDataUrl)
          ? "업스케일 소스 → 인쇄사이즈 리샘플"
          : "edge-preserving sharp upscale";
      }

      const blob: Blob = await new Promise((resolve, reject) =>
        logoCanvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG 인코딩 실패")), "image/png"),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logo_${orderNo}_${workType}_${logoWidthMm}x${logoHeightMm}mm_${dpi}dpi.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({
        title: `PNG ${dpi}dpi 다운로드 완료`,
        description: `로고 ${logoW}×${logoH}px · ${logoWidthMm}×${logoHeightMm}mm · ${modeLabel}`,
      });

    } catch (e: any) {
      toast({ title: `PNG ${dpi}dpi 다운로드 실패`, description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };


  // Vectorizer.AI 클라우드 벡터화 (고품질)
  const handleVectorizeAI = async () => {
    if (!sourceLogo) { toast({ title: "로고가 없습니다", variant: "destructive" }); return; }
    const mode = (localStorage.getItem(VECTORIZER_MODE_KEY) as "test" | "preview" | "production" | null) || "test";
    setBusy(`Vectorizer.AI 처리 중 (${mode})...`);
    try {
      let payload: { imageBase64?: string; imageUrl?: string; mode: string };
      if (sourceLogo.startsWith("data:")) {
        payload = { imageBase64: sourceLogo, mode };
      } else {
        payload = { imageUrl: sourceLogo, mode };
      }
      const { data, error } = await supabase.functions.invoke("vectorize-image", { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const svgDataUrl: string = (data as any).svgDataUrl;
      setVectorDataUrl(svgDataUrl);
      setProcessedDataUrl(svgDataUrl);
      setProcessedKind("vector");
      toast({
        title: "Vectorizer.AI 벡터 변환 완료",
        description: `모드: ${mode} · 크레딧: ${(data as any).credits ?? "-"}`,
      });
    } catch (e: any) {
      toast({ title: "Vectorizer.AI 변환 실패", description: e?.message || String(e), variant: "destructive" });
    } finally { setBusy(null); }
  };





  const downloadVectorSvg = () => {
    if (processedKind !== "vector" || !processedDataUrl) {
      toast({ title: "벡터 변환을 먼저 실행하세요", variant: "destructive" });
      return;
    }
    try {
      const svgText = svgDataUrlToText(processedDataUrl);
      const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logo_${orderNo}_${workType}_vector.svg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "SVG 다운로드 완료", description: "확대해도 깨지지 않는 진짜 벡터 파일입니다." });
    } catch (e: any) {
      toast({ title: "SVG 다운로드 실패", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const resetLogo = () => {
    setProcessedDataUrl(null);
    setProcessedKind("original");
    setUpscaledDataUrl(null);
    setVectorDataUrl(null);
  };

  const downloadResultPdf = async () => {
    if (!logoUrl && !displayedLogo) {
      toast({ title: "로고가 없습니다", variant: "destructive" });
      return;
    }
    setBusy("작업 결과물 PDF 생성 중...");
    try {
      const src = displayedLogo || logoUrl!;
      const dataUrl = src.startsWith("data:") ? src : await fetchAsDataUrl(src);
      const img = await loadImage(dataUrl);

      // Render final-effect preview to canvas (matches 최종 적용효과 미리보기)
      const px = Math.max(1200, img.naturalWidth);
      const ar = img.naturalHeight / img.naturalWidth || 1;
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = Math.round(px * ar);
      const ctx = canvas.getContext("2d")!;

      // Background per work type
      const bg =
        workType === "heat-transfer" ? "#1f2937"
        : workType === "embroidery" ? "#f3eee0"
        : workType === "laser" ? "#9ca3af"
        : "#ffffff";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Apply effect filter (best-effort match of CSS preview)
      let filter = "none";
      if (workType === "laser") filter = "grayscale(1) contrast(1.25) brightness(0.9)";
      else if (workType === "hologram") filter = "saturate(1.4) brightness(1.1)";
      ctx.filter = filter;

      if (workType === "embroidery") {
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = Math.max(1, canvas.width * 0.002);
        ctx.shadowOffsetY = Math.max(1, canvas.width * 0.002);
      } else if (workType === "hologram") {
        ctx.shadowColor = "rgba(168,85,247,0.6)";
        ctx.shadowBlur = canvas.width * 0.015;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.filter = "none";
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      const pngUrl = canvas.toDataURL("image/png");

      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = 210, pageH = 297;
      pdf.setFontSize(14);
      pdf.text(`Work Order: ${orderNo}`, 14, 16);
      pdf.setFontSize(10);
      pdf.text(`Type: ${WORK_TYPES.find(w => w.value === workType)?.label} | Size: ${logoWidthMm}×${logoHeightMm}mm | Qty: ${total} (base ${qty} + 5% ${surplus})`, 14, 23);

      const x = (pageW - logoWidthMm) / 2;
      const y = (pageH - logoHeightMm) / 2;
      // No background/border — keep output clean to match preview
      if (processedKind === "vector" && processedDataUrl?.startsWith("data:image/svg+xml")) {
        const svgText = svgDataUrlToText(processedDataUrl);
        const svgDoc = new DOMParser().parseFromString(svgText, "image/svg+xml");
        const svgEl = svgDoc.documentElement;
        await svg2pdf(svgEl, pdf, { x, y, width: logoWidthMm, height: logoHeightMm });
      } else {
        pdf.addImage(pngUrl, "PNG", x, y, logoWidthMm, logoHeightMm, undefined, "FAST");
      }

      pdf.setFontSize(8);
      pdf.text(`Logo source: ${processedKind} · Effect: ${WORK_TYPES.find(w => w.value === workType)?.label}`, 14, pageH - 10);

      pdf.save(`logo_${orderNo}_${workType}.pdf`);
      toast({ title: "PDF 다운로드 완료", description: processedKind === "vector" ? "벡터 변환본을 PDF에 직접 적용했습니다." : "벡터가 필요하면 먼저 벡터 변환을 실행하세요." });
    } catch (e: any) {
      console.error("[downloadResultPdf]", e);
      toast({ title: "PDF 생성 실패", description: e?.message || String(e), variant: "destructive" });
    } finally { setBusy(null); }
  };


  // Effect preview overlay style based on work type
  const effectClass: Record<WorkType, string> = {
    "heat-transfer": "",
    "hologram": "mix-blend-screen drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]",
    "laser": "grayscale contrast-125 brightness-90",
    "embroidery": "drop-shadow-[1px_1px_0_rgba(0,0,0,0.4)]",
    "print": "",
  };

  return (
    <div>
      <PageHeader title={`LOGO 공장 · ${orderNo}`} description="주문 상세" />
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={onBack}>
              <ChevronLeft className="w-4 h-4 mr-1" /> 목록으로
            </Button>
            <div className="text-sm text-muted-foreground">
              작업번호 <span className="font-mono text-foreground">{orderNo}</span>
            </div>
          </CardContent>
        </Card>

        {/* 작업지시서 설정 */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>작업지시서 설정</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="default" onClick={() => {
                  try {
                    localStorage.setItem(WO_LS_KEY, JSON.stringify(wo));
                    toast({ title: "작업지시서 저장됨" });
                  } catch (e: any) { toast({ title: "저장 실패", description: e?.message, variant: "destructive" }); }
                }}>저장</Button>
                <Button size="sm" variant="outline" onClick={() => printLogoWorkOrder(wo, workType, logoWidthMm, logoHeightMm, displayedLogo)}>
                  <FileText className="w-4 h-4 mr-1" />작업지시서 출력
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TxtField label="발주업체명" v={wo.company} set={v => setWoP({ company: v })} />
            <TxtField label="작업번호" v={wo.orderNo} set={v => setWoP({ orderNo: v })} />
            <div className="grid grid-cols-2 gap-2">
              <TxtField label="발주일" type="date" v={wo.orderDate} set={v => setWoP({ orderDate: v })} />
              <TxtField label="납품일" type="date" v={wo.deliveryDate} set={v => setWoP({ deliveryDate: v })} />
            </div>
            <div className="md:col-span-3 grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">기본수량</Label>
                <Input
                  type="number"
                  value={wo.baseQty}
                  onChange={(e) => {
                    const b = Number(e.target.value) || 0;
                    const s = Math.ceil(b * 0.05);
                    setWoP({ baseQty: b, surplusQty: s, totalQty: b + s });
                  }}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">여유수량 (기본수량의 5%)</Label>
                <Input value={wo.surplusQty} readOnly className="h-9 font-mono bg-muted/50" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">총수량</Label>
                <Input value={wo.totalQty} readOnly className="h-9 font-mono bg-muted/50 font-semibold" />
              </div>
            </div>
            <TxtField label="받을사람" v={wo.recipient} set={v => setWoP({ recipient: v })} />
            <TxtField label="전화번호" v={wo.phone} set={v => setWoP({ phone: v })} />
            <TxtField label="주소" v={wo.address} set={v => setWoP({ address: v })} />
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">발주특이사항</Label>
              <Textarea value={wo.notes} onChange={(e) => setWoP({ notes: e.target.value })} rows={3} placeholder="특이사항을 입력하세요" />
            </div>
          </CardContent>
        </Card>

        {/* 로고 작업 설정 박스 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>로고 작업 시안</span>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={downloadResultPdf} disabled={!sourceLogo || !!busy}>
                  <Download className="w-4 h-4 mr-1" /> 작업결과물 다운로드 (PDF)
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Test logo upload */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-dashed bg-muted/20">
              <div className="flex items-center gap-3 min-w-0">
                <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">테스트 로고 업로드</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {testLogoDataUrl
                      ? <>현재 적용됨: <span className="font-mono">{testLogoName}</span> · 제거하면 원본 로고로 복원됩니다</>
                      : "테스트용 로고 파일을 업로드하면 원본 대신 사용됩니다 (PNG/JPG/SVG)"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={testLogoInputRef}
                  type="file"
                  accept="image/*,.svg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleTestLogoSelect(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (testLogoInputRef.current) {
                      testLogoInputRef.current.value = "";
                      testLogoInputRef.current.click();
                    }
                  }}
                >
                  <Upload className="w-3 h-3 mr-1" /> {testLogoDataUrl ? "교체" : "업로드"}
                </Button>
                {testLogoDataUrl && (
                  <Button size="sm" variant="ghost" onClick={handleRemoveTestLogo}>
                    <Trash2 className="w-3 h-3 mr-1" /> 제거
                  </Button>
                )}
              </div>
            </div>


            {/* Settings row 1: 작업종류 + 인쇄영역 */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">작업종류</Label>
                <Select value={workType} onValueChange={(v) => setWorkType(v as WorkType)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WORK_TYPES.map(w => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">인쇄영역 가로 (mm)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="1"
                    min={1}
                    value={canvasWidthMm}
                    onChange={(e) => setCanvasWidthMm(Math.max(1, Number(e.target.value) || 0))}
                    className="h-9 pr-10"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">mm</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">인쇄영역 세로 (mm)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="1"
                    min={1}
                    value={canvasHeightMm}
                    onChange={(e) => setCanvasHeightMm(Math.max(1, Number(e.target.value) || 0))}
                    className="h-9 pr-10"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">mm</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">업스케일</Label>
                <Button size="sm" variant="outline" className="w-full h-9" onClick={handleUpscale} disabled={!sourceLogo || !!busy} title="edge-preserving 2× upscale">
                  <Sparkles className="w-3 h-3 mr-1" /> 실행
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">AI 벡터화 (Vectorizer.AI)</Label>
                <Button
                  size="sm"
                  className="w-full h-9"
                  onClick={handleVectorizeAI}
                  disabled={!sourceLogo || !!busy}
                  title="고품질 SVG · 시스템 설정에서 모드 선택"
                >
                  <Cloud className="w-3 h-3 mr-1" /> AI 변환
                </Button>
              </div>
            </div>

            {/* Settings row 2: 로고 크기 + 위치 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 rounded-md border bg-muted/20">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">로고 가로 (mm)</Label>
                  <label className="text-[10px] text-muted-foreground flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} className="h-3 w-3" />
                    비율
                  </label>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.5"
                    value={logoWidthMm}
                    onChange={(e) => handleWidthChange(Number(e.target.value) || 0)}
                    className="h-9 pr-10"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">mm</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">로고 세로 (mm)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.5"
                    value={logoHeightMm}
                    onChange={(e) => handleHeightChange(Number(e.target.value) || 0)}
                    className="h-9 pr-10"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">mm</span>
                </div>
              </div>
              <div className="space-y-1 md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">로고 크기 (인쇄영역 대비 {logoScalePct}%)</Label>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => { setOffsetXMm(0); setOffsetYMm(0); setLogoScalePct(50); }}>
                    중앙·50%
                  </Button>
                </div>
                <Slider min={1} max={100} step={1} value={[logoScalePct]} onValueChange={(v) => setLogoScalePct(v[0])} />
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">가로 위치 X ({clampedOffsetX.toFixed(1)} mm · 중앙 기준)</Label>
                <Slider
                  min={-maxOffsetX}
                  max={maxOffsetX}
                  step={0.5}
                  value={[clampedOffsetX]}
                  onValueChange={(v) => setOffsetXMm(v[0])}
                  disabled={maxOffsetX === 0}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">세로 위치 Y ({clampedOffsetY.toFixed(1)} mm · 중앙 기준)</Label>
                <Slider
                  min={-maxOffsetY}
                  max={maxOffsetY}
                  step={0.5}
                  value={[clampedOffsetY]}
                  onValueChange={(v) => setOffsetYMm(v[0])}
                  disabled={maxOffsetY === 0}
                />
              </div>
            </div>

            {busy && <div className="text-xs text-muted-foreground">{busy}</div>}

            {/* Preview grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border rounded-md p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">로고 미리보기</div>
                  <Badge variant="outline" className="text-[10px]">
                    {processedKind === "original" ? "원본" : processedKind === "upscaled" ? "업스케일" : "벡터(SVG)"}
                  </Badge>
                </div>
                <div className="aspect-square w-full border rounded bg-muted/20 flex items-center justify-center overflow-hidden">
                  {displayedLogo ? (
                    <img src={displayedLogo} alt="로고" className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex flex-col items-center text-muted-foreground gap-1">
                      <ImageOff className="w-8 h-8" />
                      <span className="text-xs">로고가 없습니다</span>
                    </div>
                  )}
                </div>
                {processedKind !== "original" && (
                  <Button size="sm" variant="ghost" className="w-full" onClick={resetLogo}>원본으로 복원</Button>
                )}
              </div>

              <div className="border rounded-md p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">인쇄영역 미리보기 (실제 비율)</div>
                  <Badge>{WORK_TYPES.find(w => w.value === workType)?.label}</Badge>
                </div>
                {/* Canvas frame at real aspect ratio of 인쇄영역 */}
                <div
                  className="w-full border-2 border-dashed border-primary/60 rounded relative overflow-hidden"
                  style={{
                    aspectRatio: `${canvasWidthMm} / ${canvasHeightMm}`,
                    background: "repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%) 50% / 16px 16px",
                  }}
                >
                  {/* Center cross-hair guide */}
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-primary/20" />
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/20" />
                  </div>
                  {/* Canvas size label */}
                  <div className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-background/80 border font-mono">
                    {canvasWidthMm} × {canvasHeightMm} mm
                  </div>
                  {displayedLogo && logoWidthMm > 0 && logoHeightMm > 0 && (
                    <div
                      className="absolute"
                      style={{
                        width: `${Math.min(100, (logoWidthMm / canvasWidthMm) * 100)}%`,
                        height: `${Math.min(100, (logoHeightMm / canvasHeightMm) * 100)}%`,
                        left: `calc(50% + ${(clampedOffsetX / canvasWidthMm) * 100}% - ${Math.min(100, (logoWidthMm / canvasWidthMm) * 100) / 2}%)`,
                        top: `calc(50% + ${(clampedOffsetY / canvasHeightMm) * 100}% - ${Math.min(100, (logoHeightMm / canvasHeightMm) * 100) / 2}%)`,
                      }}
                    >
                      <img
                        src={displayedLogo}
                        alt="logo on canvas"
                        className={`w-full h-full object-contain ${effectClass[workType]}`}
                        referrerPolicy="no-referrer"
                        draggable={false}
                      />
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <div>인쇄영역: <span className="font-mono">{canvasWidthMm} × {canvasHeightMm} mm</span></div>
                  <div>로고 크기: <span className="font-mono">{logoWidthMm} × {logoHeightMm} mm</span> (영역 대비 {logoScalePct}%)</div>
                  <div>로고 위치: X <span className="font-mono">{clampedOffsetX.toFixed(1)}</span> · Y <span className="font-mono">{clampedOffsetY.toFixed(1)}</span> mm · 수량 {total} EA</div>
                </div>
              </div>
            </div>


            {/* Compare viewer: original vs processed (vector) */}
            {sourceLogo && (
              <div className="border rounded-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">원본 ↔ 변환 결과 확대 비교</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 rounded-md border p-0.5">
                      <Button size="sm" variant={compareTarget === "upscaled" ? "default" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setCompareTarget("upscaled")} disabled={!upscaledDataUrl} title={!upscaledDataUrl ? "먼저 '업스케일'을 실행하세요" : "업스케일 결과와 비교"}>업스케일</Button>
                      <Button size="sm" variant={compareTarget === "vector" ? "default" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setCompareTarget("vector")} disabled={!vectorDataUrl} title={!vectorDataUrl ? "먼저 '벡터 변환'을 실행하세요" : "벡터 결과와 비교"}>벡터</Button>
                    </div>
                    <div className="flex items-center gap-1 rounded-md border p-0.5">
                      <Button size="sm" variant={compareMode === "side" ? "default" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setCompareMode("side")}>좌우</Button>
                      <Button size="sm" variant={compareMode === "slider" ? "default" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setCompareMode("slider")}>오버레이</Button>
                    </div>
                    <div className="flex items-center gap-1 rounded-md border p-0.5">
                      {(["checker", "white", "black"] as const).map(b => (
                        <Button key={b} size="sm" variant={compareBg === b ? "default" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setCompareBg(b)}>
                          {b === "checker" ? "체커" : b === "white" ? "백" : "흑"}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Zoom control */}
                <div className="flex items-center gap-3">
                  <Label className="text-xs w-14 shrink-0">확대 {compareZoom.toFixed(1)}×</Label>
                  <Slider min={1} max={10} step={0.5} value={[compareZoom]} onValueChange={(v) => setCompareZoom(v[0])} className="flex-1" />
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setCompareZoom(1); setCompareOrigin({ x: 50, y: 50 }); }}>초기화</Button>
                </div>

                {(() => {
                  const targetUrl = compareTarget === "vector" ? vectorDataUrl : upscaledDataUrl;
                  const targetLabel = compareTarget === "vector" ? "벡터 변환" : "업스케일 (2×)";
                  const ready = !!targetUrl;
                  return (
                    <>
                      {!ready && (
                        <div className="text-xs text-muted-foreground p-3 rounded bg-muted/30">
                          ※ 비교를 위해 먼저 '{compareTarget === "vector" ? "벡터 변환" : "업스케일"}'을 실행하세요. 현재는 원본만 표시됩니다.
                        </div>
                      )}
                      {compareMode === "side" ? (
                        <div className="grid grid-cols-2 gap-3">
                          <CompareTile label="원본" src={sourceLogo} zoom={compareZoom} origin={compareOrigin} onMove={setCompareOrigin} bg={compareBg} />
                          <CompareTile label={targetLabel} src={targetUrl || sourceLogo} zoom={compareZoom} origin={compareOrigin} onMove={setCompareOrigin} bg={compareBg} muted={!ready} />
                        </div>
                      ) : (
                        <CompareOverlay
                          original={sourceLogo}
                          processed={targetUrl}
                          zoom={compareZoom}
                          origin={compareOrigin}
                          onMove={setCompareOrigin}
                          sliderPct={sliderPct}
                          onSliderChange={setSliderPct}
                          bg={compareBg}
                        />
                      )}
                    </>
                  );
                })()}
                <p className="text-[10px] text-muted-foreground">
                  ※ 이미지 위에서 마우스를 움직이면 확대 중심점이 따라옵니다. 좌우 모드는 동기화된 확대, 오버레이 모드는 가운데 핸들을 드래그해 비교하세요.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const CHECKER_BG = "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%) 50% / 16px 16px";
const bgStyle = (b: "checker" | "white" | "black"): React.CSSProperties =>
  b === "checker" ? { background: CHECKER_BG } : b === "white" ? { background: "#ffffff" } : { background: "#0a0a0a" };

function CompareTile({
  label, src, zoom, origin, onMove, bg, muted,
}: {
  label: string;
  src: string;
  zoom: number;
  origin: { x: number; y: number };
  onMove: (o: { x: number; y: number }) => void;
  bg: "checker" | "white" | "black";
  muted?: boolean;
}) {
  const handle = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    onMove({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-[10px]">{label}</Badge>
        {muted && <span className="text-[10px] text-muted-foreground">변환 대기</span>}
      </div>
      <div
        className="aspect-square w-full border rounded overflow-hidden cursor-crosshair relative"
        style={bgStyle(bg)}
        onMouseMove={handle}
      >
        <img
          src={src}
          alt={label}
          className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: `${origin.x}% ${origin.y}%`,
            transition: "transform 80ms linear",
            opacity: muted ? 0.5 : 1,
          }}
          draggable={false}
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}

function CompareOverlay({
  original, processed, zoom, origin, onMove, sliderPct, onSliderChange, bg,
}: {
  original: string;
  processed: string | null;
  zoom: number;
  origin: { x: number; y: number };
  onMove: (o: { x: number; y: number }) => void;
  sliderPct: number;
  onSliderChange: (n: number) => void;
  bg: "checker" | "white" | "black";
}) {
  const dragging = useRef(false);
  const setOriginFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    onMove({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
    if (dragging.current) {
      onSliderChange(Math.max(0, Math.min(100, x)));
    }
  };
  return (
    <div
      className="relative w-full border rounded overflow-hidden select-none"
      style={{ ...bgStyle(bg), aspectRatio: "2 / 1" }}
      onMouseMove={setOriginFromEvent}
      onMouseDown={() => { dragging.current = true; }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
    >
      <img
        src={original}
        alt="원본"
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        style={{ transform: `scale(${zoom})`, transformOrigin: `${origin.x}% ${origin.y}%` }}
        draggable={false}
        referrerPolicy="no-referrer"
      />
      {processed && (
        <img
          src={processed}
          alt="벡터"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: `${origin.x}% ${origin.y}%`,
            clipPath: `inset(0 0 0 ${sliderPct}%)`,
          }}
          draggable={false}
        />
      )}
      {/* Labels */}
      <div className="absolute top-1 left-2 text-[10px] px-1.5 py-0.5 rounded bg-background/80 border">원본</div>
      {processed && <div className="absolute top-1 right-2 text-[10px] px-1.5 py-0.5 rounded bg-background/80 border">벡터</div>}
      {/* Handle */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-primary cursor-ew-resize"
        style={{ left: `${sliderPct}%` }}
      >
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-primary border-2 border-background shadow flex items-center justify-center text-[10px] text-primary-foreground">⇆</div>
      </div>
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

function printLogoWorkOrder(
  wo: { company: string; orderNo: string; orderDate: string; deliveryDate: string; baseQty: number; surplusQty: number; totalQty: number; recipient: string; phone: string; address: string; notes: string },
  workType: WorkType,
  logoWidthMm: number,
  logoHeightMm: number,
  logoSrc: string | null,
) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const typeLabel = WORK_TYPES.find(w => w.value === workType)?.label || workType;
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>作业指示书 - ${esc(wo.orderNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "PingFang SC", "Microsoft YaHei", "SimHei", "Noto Sans SC", sans-serif; color:#111; margin:0; padding:0; }
  h1 { font-size: 22pt; text-align:center; margin: 0 0 4mm; letter-spacing: 8px; border-bottom: 2px solid #111; padding-bottom: 4mm; }
  .meta { display:flex; justify-content:space-between; font-size: 9pt; color:#555; margin-bottom: 6mm; }
  table { width:100%; border-collapse: collapse; font-size: 10pt; }
  table th, table td { border: 1px solid #333; padding: 2.5mm 3mm; vertical-align: middle; }
  table th { background:#f2f2f2; font-weight:600; width: 22%; text-align:left; }
  .qty th, .qty td { text-align:center; }
  .notes { min-height: 22mm; white-space: pre-wrap; }
  h2 { font-size: 12pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  .logo-box { text-align:center; padding: 6mm; border: 1px solid #333; }
  .logo-box img { max-width: 60mm; max-height: 60mm; object-fit: contain; }
  .sig { margin-top: 10mm; display:flex; justify-content:flex-end; gap: 10mm; font-size: 10pt; }
  .sig div { border-top:1px solid #333; padding-top:2mm; min-width: 40mm; text-align:center; }
  .no-print { position:fixed; top:8px; right:8px; }
  .no-print button { padding: 8px 14px; font-size: 13px; cursor:pointer; }
  @media print { .no-print { display:none; } }
</style></head>
<body>
  <div class="no-print"><button onclick="window.print()">打印 / 保存PDF</button></div>
  <h1>作 业 指 示 书</h1>
  <div class="meta"><span>发包方:${esc(wo.company)}</span><span>打印日期:${today}</span></div>
  <table>
    <tr><th>发包公司</th><td>${esc(wo.company)}</td><th>作业编号</th><td>${esc(wo.orderNo)}</td></tr>
    <tr><th>下单日期</th><td>${esc(wo.orderDate)}</td><th>交货日期</th><td>${esc(wo.deliveryDate)}</td></tr>
    <tr><th>收件人</th><td>${esc(wo.recipient)}</td><th>联系电话</th><td>${esc(wo.phone)}</td></tr>
    <tr><th>收货地址</th><td colspan="3">${esc(wo.address)}</td></tr>
    <tr><th>作业类型</th><td>${esc(typeLabel)}</td><th>LOGO 尺寸</th><td>${esc(logoWidthMm)} × ${esc(logoHeightMm)} mm</td></tr>
  </table>
  <h2>数量</h2>
  <table class="qty">
    <tr><th>基本数量</th><th>富余数量 (5%)</th><th>总数量</th></tr>
    <tr><td>${esc(wo.baseQty)}</td><td>${esc(wo.surplusQty)}</td><td><strong>${esc(wo.totalQty)}</strong></td></tr>
  </table>
  <h2>订单特殊事项</h2>
  <table><tr><td class="notes">${esc(wo.notes) || "&nbsp;"}</td></tr></table>
  <h2>LOGO 样式</h2>
  <div class="logo-box">
    ${logoSrc ? `<img src="${esc(logoSrc)}" alt="logo" />` : `<span style="color:#999;">无 LOGO</span>`}
  </div>
  <div class="sig"><div>负责人</div><div>审批</div></div>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 400));</script>
</body></html>`;
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", description: "팝업을 허용해주세요", variant: "destructive" }); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
