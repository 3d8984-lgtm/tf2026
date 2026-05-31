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
import { Eye, ImageOff, ChevronLeft, FileText, Download, Sparkles, Upload, Trash2, Cloud, Package, CheckCircle2, Settings, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { supabase } from "@/integrations/supabase/client";
import { VECTORIZER_MODE_KEY } from "./OutsourceSettings";
import { smartUpscale, analyzeImage, type UpscaleMode, type ImageAnalysis } from "@/lib/upscale";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import JSZip from "jszip";
import html2canvas from "html2canvas";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { ExternalLink } from "lucide-react";
import QRCode from "qrcode";

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

// Smart upscale (Lanczos3 + auto image-type pipeline) lives in src/lib/upscale.ts.
// The local `edgePreservingUpscale` was removed in favour of the shared helper,
// which auto-selects Nearest / Lanczos3 + per-type sharpening based on input
// content (pixel-art / logo / text / illustration / photo).


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
  const PRINT_AREA_LS_KEY = `logo.printArea.v1.${orderNo}`;
  const [canvasWidthMm, setCanvasWidthMm] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(`logo.printArea.v1.${orderNo}`);
      if (raw) { const o = JSON.parse(raw); if (o?.w) return Number(o.w); }
    } catch {}
    return DEFAULT_CANVAS_MM;
  });
  const [canvasHeightMm, setCanvasHeightMm] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(`logo.printArea.v1.${orderNo}`);
      if (raw) { const o = JSON.parse(raw); if (o?.h) return Number(o.h); }
    } catch {}
    return DEFAULT_CANVAS_MM;
  });
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
  const upscaledUploadInputRef = useRef<HTMLInputElement>(null);
  const [upscaledUploadName, setUpscaledUploadName] = useState<string | null>(null);
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
  // Smart-upscale controls (decision-matrix-driven, see src/lib/upscale.ts)
  const [upscaleMode, setUpscaleMode] = useState<UpscaleMode>("auto");
  const [upscaleSharpness, setUpscaleSharpness] = useState<number>(50);
  const [lastAnalysis, setLastAnalysis] = useState<ImageAnalysis | null>(null);
  const [lastMethod, setLastMethod] = useState<string | null>(null);

  // ── Wizard state (로고 시안 단계별 진행) ────────────────────────────
  type LogoType = "color" | "mono";
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [logoType, setLogoType] = useState<LogoType | null>(null);
  const [recommendedType, setRecommendedType] = useState<LogoType | null>(null);
  const [analyzedSrc, setAnalyzedSrc] = useState<string | null>(null);
  const [upscaleSkipped, setUpscaleSkipped] = useState<boolean>(false);
  const [printAreaSaved, setPrintAreaSaved] = useState<boolean>(() => {
    try { return !!localStorage.getItem(`logo.printArea.v1.${orderNo}`); } catch { return false; }
  });

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

  // Auto-analyze source logo whenever it changes → recommend 컬러/단색 type
  useEffect(() => {
    const src = testLogoDataUrl || logoUrl;
    if (!src || src === analyzedSrc) return;
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = src.startsWith("data:") ? src : await fetchAsDataUrl(src);
        const img = await loadImage(dataUrl);
        if (cancelled) return;
        const analysis = analyzeImage(img);
        setLastAnalysis(analysis);
        // 단순/단색 휴리스틱: 고유 색 ≤ 48 또는 line_art / text / pixel
        const isMono =
          analysis.kind === "line_art_logo" ||
          analysis.kind === "document_text" ||
          analysis.kind === "pixel_art" ||
          analysis.uniqueColors <= 48;
        const rec: LogoType = isMono ? "mono" : "color";
        setRecommendedType(rec);
        if (!logoType) setLogoType(rec);
        setAnalyzedSrc(src);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** Download any URL (data: or remote) as a file via a temporary <a>. */
  const downloadUrl = async (url: string, filename: string) => {
    try {
      const dataUrl = url.startsWith("data:") ? url : await fetchAsDataUrl(url);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      toast({ title: "다운로드 실패", description: e?.message || String(e), variant: "destructive" });
    }
  };

  /** User uploads an externally-upscaled file (e.g. from Let's Enhance). */
  const handleUpscaledUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "이미지 파일만 업로드 가능합니다", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setUpscaledDataUrl(dataUrl);
      setProcessedDataUrl(dataUrl);
      setProcessedKind("upscaled");
      setCompareTarget("upscaled");
      setUpscaledUploadName(file.name);
      toast({ title: "업스케일 결과 업로드 완료", description: file.name });
    };
    reader.onerror = () => toast({ title: "파일 읽기 실패", variant: "destructive" });
    reader.readAsDataURL(file);
  };

  const handleUpscale = async () => {
    if (!sourceLogo) return;
    setBusy("로고 업스케일링 중 (smart Lanczos3)...");
    try {
      const src = sourceLogo!;
      const dataUrl = src.startsWith("data:") ? src : await fetchAsDataUrl(src);
      const img = await loadImage(dataUrl);
      const targetW = img.naturalWidth * 2;
      const targetH = img.naturalHeight * 2;
      const { canvas, analysis, method } = smartUpscale(img, targetW, targetH, {
        mode: upscaleMode,
        sharpness: upscaleSharpness,
      });
      const up = canvas.toDataURL("image/png");
      setUpscaledDataUrl(up);
      setProcessedDataUrl(up);
      setProcessedKind("upscaled");
      setCompareTarget("upscaled");
      setLastAnalysis(analysis);
      setLastMethod(method);
      toast({
        title: "업스케일 완료",
        description: `${img.naturalWidth}×${img.naturalHeight} → ${canvas.width}×${canvas.height} · ${method}`,
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
        const { canvas: c, method } = smartUpscale(img, logoW, logoH, {
          mode: upscaleMode,
          sharpness: upscaleSharpness,
        });
        logoCanvas = c;
        modeLabel = (processedKind === "upscaled" && upscaledDataUrl)
          ? `업스케일 소스 → ${method}`
          : method;
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

      // Keep transparent background — do not fill, so transparent PNG inputs stay transparent in the output.

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

        {/* 발주 진행 (3단계) */}
        <LogoOrderProgressBox
          order={order}
          wo={wo}
          workType={workType}
          logoWidthMm={logoWidthMm}
          logoHeightMm={logoHeightMm}
          displayedLogo={displayedLogo}
          vectorDataUrl={vectorDataUrl}
        />

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
            {(() => {
              const STEPS = [
                { id: 1, label: "업로드" },
                { id: 2, label: "타입 확인" },
                { id: 3, label: "업스케일" },
                { id: 7, label: "업스케일 업로드" },
                { id: 4, label: "벡터 변환" },
                { id: 5, label: "인쇄영역·미리보기 & PDF" },
              ].filter(s => s.id !== 4 || logoType === "mono");

              const step1Done = !!sourceLogo;
              const step2Done = !!logoType;
              const step3Done = !!upscaledDataUrl || upscaleSkipped || (logoType === "mono" && !!vectorDataUrl);
              const step7Done = !!upscaledUploadName || !!upscaledDataUrl || upscaleSkipped;
              const step4Done = !!vectorDataUrl;
              const step5Done = printAreaSaved;
              const doneMap: Record<number, boolean> = { 1: step1Done, 2: step2Done, 3: step3Done, 7: step7Done, 4: step4Done, 5: step5Done, 6: false };

              const canAdvance = (id: number) => {
                if (id === 1) return step1Done;
                if (id === 2) return step2Done;
                if (id === 3) return step3Done;
                if (id === 7) return true; // optional step — skip allowed
                if (id === 4) return step4Done;
                if (id === 5) return step5Done;
                return false;
              };
              const idx = STEPS.findIndex(s => s.id === currentStep);
              const next = () => { const n = STEPS[idx + 1]; if (n) setCurrentStep(n.id); };
              const prev = () => { const p = STEPS[idx - 1]; if (p) setCurrentStep(p.id); };

              return (
                <div className="space-y-4">
                  {/* Horizontal Stepper */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-2">
                    {STEPS.map((s, i) => {
                      const active = s.id === currentStep;
                      const done = doneMap[s.id];
                      return (
                        <div key={s.id} className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setCurrentStep(s.id)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs transition-colors ${
                              active ? "bg-primary text-primary-foreground border-primary" : done ? "bg-muted border-border" : "bg-background border-border text-muted-foreground"
                            }`}
                          >
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold ${
                              done ? "bg-emerald-500 text-white" : active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted-foreground/20"
                            }`}>
                              {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : (i + 1)}
                            </span>
                            <span className="whitespace-nowrap font-medium">{s.label}</span>
                          </button>
                          {i < STEPS.length - 1 && <div className="w-4 h-px bg-border" />}
                        </div>
                      );
                    })}
                  </div>

                  {busy && (
                    <div className="text-xs text-muted-foreground px-3 py-2 rounded bg-muted/30 border">{busy}</div>
                  )}

                  {/* ============ STEP 1: 업로드 ============ */}
                  {currentStep === 1 && (
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        원본 로고를 업로드하세요. 업로드 즉시 시스템이 자동 분석하여 다음 단계에서 적합한 처리 방식을 추천합니다.
                        <span className="block mt-1">⚠️ LOGO 이외에는 <b>배경이 투명</b>이어야 합니다.</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-dashed bg-muted/20">
                        <div className="flex items-center gap-3 min-w-0">
                          <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium">로고 업로드</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {testLogoDataUrl
                                ? <>현재 적용됨: <span className="font-mono">{testLogoName}</span></>
                                : sourceLogo
                                  ? "원본 로고(주문 첨부)가 적용되어 있습니다. 교체하려면 업로드하세요."
                                  : "PNG/JPG/SVG 파일을 업로드하세요"}
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
                          <Button size="sm" variant="outline" onClick={() => { if (testLogoInputRef.current) { testLogoInputRef.current.value = ""; testLogoInputRef.current.click(); } }}>
                            <Upload className="w-3 h-3 mr-1" /> {testLogoDataUrl ? "교체" : "업로드"}
                          </Button>
                          {testLogoDataUrl && (
                            <Button size="sm" variant="ghost" onClick={handleRemoveTestLogo}>
                              <Trash2 className="w-3 h-3 mr-1" /> 제거
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* 원본 로고 — 작업번호당 1개 (로고 없어도 정보는 표시) */}
                      <div className="rounded-md border bg-blue-50/40 dark:bg-blue-950/20 overflow-hidden">
                        <div className="px-3 py-2 text-sm font-semibold flex items-center gap-2 border-b bg-background/40">
                          <Cloud className="w-4 h-4" />
                          {logoUrl
                            ? "API로 받은 원본 로고"
                            : testLogoDataUrl
                              ? "업로드한 로고 (API 원본 없음)"
                              : "원본 로고 (미등록)"}
                          <Badge variant="outline" className="text-[10px]">
                            {logoUrl ? "주문 첨부" : testLogoDataUrl ? "로컬 업로드" : "없음"} · 1건
                          </Badge>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>작업번호</TableHead>
                              <TableHead>로고 고유번호</TableHead>
                              <TableHead>QR</TableHead>
                              <TableHead>미리보기</TableHead>
                              <TableHead className="text-right">동작</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell className="font-mono">{orderNo}</TableCell>
                              <TableCell className="font-mono font-medium">{`${orderNo}-1`}</TableCell>
                              <TableCell><QrThumb value={`${orderNo}-1`} /></TableCell>
                              <TableCell>
                                <div className="w-12 h-12 border rounded bg-white flex items-center justify-center overflow-hidden">
                                  {(logoUrl || testLogoDataUrl) ? (
                                    <img src={(logoUrl || testLogoDataUrl)!} alt="로고" className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground">없음</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {(logoUrl || testLogoDataUrl) && (
                                    <Button size="sm" variant="outline" onClick={() => downloadUrl((logoUrl || testLogoDataUrl)!, `${orderNo}-1.png`)}>
                                      <Download className="w-3 h-3 mr-1" /> 다운로드
                                    </Button>
                                  )}
                                  <Button size="sm" variant={(logoUrl || testLogoDataUrl) ? "ghost" : "default"} onClick={() => { if (testLogoInputRef.current) { testLogoInputRef.current.value = ""; testLogoInputRef.current.click(); } }}>
                                    <Upload className="w-3 h-3 mr-1" /> {testLogoDataUrl ? "교체" : "수동 업로드"}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                        {!logoUrl && !testLogoDataUrl && (
                          <div className="px-3 py-2 text-[11px] text-muted-foreground border-t bg-muted/10">
                            API로 받은 원본 로고가 없습니다. 우측 <b>수동 업로드</b> 버튼으로 로고 파일을 등록하세요.
                          </div>
                        )}
                      </div>


                      {sourceLogo && (
                        <div className="flex items-start gap-4 p-3 rounded-md border bg-muted/10">
                          <div className="w-24 h-24 border rounded bg-muted/20 flex items-center justify-center overflow-hidden shrink-0">
                            <img src={sourceLogo} alt="로고" className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                          </div>
                          <div className="text-xs space-y-1 flex-1 min-w-0">
                            <div className="font-semibold text-sm flex items-center gap-2">
                              자동 분석 결과
                              <Badge variant="secondary" className="text-[10px]">{testLogoDataUrl ? "업로드본" : "API 원본"}</Badge>
                            </div>
                            {lastAnalysis ? (
                              <>
                                <div>해상도: <span className="font-mono">{lastAnalysis.width}×{lastAnalysis.height}px</span></div>
                                <div>유형: <span className="font-mono">{lastAnalysis.kind}</span></div>
                                <div>고유 색상 수: <span className="font-mono">{lastAnalysis.uniqueColors}</span></div>
                                <div>배경 투명: {lastAnalysis.transparent ? <span className="text-emerald-600 font-medium">✓ 투명</span> : <span className="text-amber-600 font-medium">⚠️ 불투명 (LOGO가 아닌 경우 투명배경 필요)</span>}</div>
                                <div className="pt-1">추천 타입: <Badge variant={recommendedType === "color" ? "default" : "secondary"}>{recommendedType === "color" ? "🎨 컬러 / 복잡" : "⚫ 단색 / 단순"}</Badge></div>
                              </>
                            ) : <div className="text-muted-foreground">분석 중...</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ============ STEP 2: 타입 확인 ============ */}
                  {currentStep === 2 && (
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        로고 처리 방식을 선택하세요. 시스템 추천을 참고하되, 최종 선택은 사용자가 결정합니다.
                      </div>
                      <RadioGroup value={logoType ?? ""} onValueChange={(v) => setLogoType(v as LogoType)} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label htmlFor="lt-color" className={`flex gap-3 p-4 rounded-md border cursor-pointer ${logoType === "color" ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}>
                          <RadioGroupItem id="lt-color" value="color" className="mt-1" />
                          <div className="space-y-1">
                            <div className="font-semibold text-sm flex items-center gap-2">🎨 컬러 / 복잡한 로고 {recommendedType === "color" && <Badge variant="outline" className="text-[10px]">추천</Badge>}</div>
                            <div className="text-xs text-muted-foreground">사진·일러스트·다채로운 로고. <b>업스케일링만</b> 진행 후 PDF로 전달합니다.</div>
                            <div className="text-[10px] text-muted-foreground">단계: 업스케일 → 인쇄영역 → PDF</div>
                          </div>
                        </label>
                        <label htmlFor="lt-mono" className={`flex gap-3 p-4 rounded-md border cursor-pointer ${logoType === "mono" ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}>
                          <RadioGroupItem id="lt-mono" value="mono" className="mt-1" />
                          <div className="space-y-1">
                            <div className="font-semibold text-sm flex items-center gap-2">⚫ 단색 / 단순 로고 {recommendedType === "mono" && <Badge variant="outline" className="text-[10px]">추천</Badge>}</div>
                            <div className="text-xs text-muted-foreground">라인아트·텍스트·단색 로고. 필요 시 업스케일 후 <b>벡터 변환</b>까지 진행합니다.</div>
                            <div className="text-[10px] text-muted-foreground">단계: 업스케일(선택) → 벡터 변환 → 인쇄영역 → PDF</div>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>
                  )}

                  {/* ============ STEP 3: 업스케일 ============ */}
                  {currentStep === 3 && (
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">
                        {logoType === "color"
                          ? "컬러 로고는 업스케일링이 필수입니다. Let's Enhance에서 업스케일한 파일을 다시 업로드하거나, 사이트 내장 업스케일을 실행하세요."
                          : "단색 로고는 업스케일이 선택입니다. 해상도가 충분하면 건너뛰고 바로 벡터 변환을 진행할 수 있습니다."}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Let's Enhance 외부 */}
                        <div className="p-4 rounded-md border space-y-3">
                          <div className="font-semibold text-sm">① 외부: Let's Enhance</div>
                          <p className="text-xs text-muted-foreground">새 창에서 업스케일 후 결과 PNG를 위 "업로드" 단계에서 다시 올려주세요.</p>
                          <Button size="sm" variant="outline" onClick={() => window.open("https://letsenhance.io/ko/boost", "_blank", "noopener,noreferrer")}>
                            <ExternalLink className="w-3 h-3 mr-1" /> Let's Enhance 새 창
                          </Button>
                        </div>

                        {/* 내장 업스케일 */}
                        <div className="p-4 rounded-md border space-y-3">
                          <div className="font-semibold text-sm">② 사이트 내장 업스케일 (2×)</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[10px]">모드</Label>
                              <Select value={upscaleMode} onValueChange={(v) => setUpscaleMode(v as UpscaleMode)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="auto">자동</SelectItem>
                                  <SelectItem value="logo">로고/라인</SelectItem>
                                  <SelectItem value="text">텍스트</SelectItem>
                                  <SelectItem value="illustration">일러스트</SelectItem>
                                  <SelectItem value="photo">사진</SelectItem>
                                  <SelectItem value="pixel">픽셀</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px]">샤프니스 {upscaleSharpness}</Label>
                              <Slider value={[upscaleSharpness]} min={0} max={100} step={5} onValueChange={(v) => setUpscaleSharpness(v[0])} />
                            </div>
                          </div>
                          <Button size="sm" className="w-full" onClick={handleUpscale} disabled={!sourceLogo || !!busy}>
                            <Sparkles className="w-3 h-3 mr-1" /> 업스케일 실행
                          </Button>
                          {upscaledDataUrl && <div className="text-[11px] text-emerald-600">✓ 업스케일 완료</div>}
                        </div>
                      </div>

                      {logoType === "mono" && !upscaledDataUrl && (
                        <div className="flex items-center justify-between p-3 rounded-md bg-muted/20 border">
                          <div className="text-xs text-muted-foreground">업스케일이 필요하지 않다면 이 단계를 건너뛸 수 있습니다.</div>
                          <Button size="sm" variant="ghost" onClick={() => { setUpscaleSkipped(true); next(); }}>건너뛰기 →</Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ============ STEP 7: 업스케일 결과 업로드 ============ */}
                  {currentStep === 7 && (
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">
                        외부 도구(Let's Enhance 등)에서 업스케일한 결과 파일을 업로드하세요. 사이트 내장 업스케일을 사용했다면 이 단계는 건너뛰어도 됩니다.
                      </div>

                      <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-dashed bg-muted/20">
                        <div className="flex items-center gap-3 min-w-0">
                          <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium">업스케일 파일 업로드</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {upscaledUploadName
                                ? <>업로드됨: <span className="font-mono">{upscaledUploadName}</span></>
                                : upscaledDataUrl
                                  ? "사이트 내장 업스케일 결과가 적용되어 있습니다. 외부 업스케일본으로 교체하려면 업로드하세요."
                                  : "PNG/JPG 파일을 업로드하세요 (배경 투명 유지)"}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            ref={upscaledUploadInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUpscaledUpload(f);
                              e.target.value = "";
                            }}
                          />
                          <Button size="sm" variant="outline" onClick={() => upscaledUploadInputRef.current?.click()}>
                            <Upload className="w-3 h-3 mr-1" /> {upscaledUploadName || upscaledDataUrl ? "교체" : "업로드"}
                          </Button>
                        </div>
                      </div>

                      {upscaledDataUrl && (
                        <div className="flex items-start gap-4 p-3 rounded-md border bg-muted/10">
                          <div className="w-24 h-24 border rounded bg-muted/20 flex items-center justify-center overflow-hidden shrink-0">
                            <img src={upscaledDataUrl} alt="업스케일 결과" className="max-w-full max-h-full object-contain" />
                          </div>
                          <div className="text-xs space-y-1 flex-1 min-w-0">
                            <div className="font-semibold text-sm flex items-center gap-2">
                              현재 업스케일 결과 <Badge variant="secondary" className="text-[10px]">{upscaledUploadName ? "외부 업로드" : "사이트 내장"}</Badge>
                            </div>
                            <div className="text-muted-foreground">다음 단계에서 이 파일을 기준으로 작업이 진행됩니다.</div>
                            <div className="pt-1">
                              <Button size="sm" variant="outline" onClick={() => downloadUrl(upscaledDataUrl, `logo-upscaled-${orderNo}.png`)}>
                                <Download className="w-3 h-3 mr-1" /> 다운로드
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {!upscaledDataUrl && (
                        <div className="flex items-center justify-between p-3 rounded-md bg-muted/20 border">
                          <div className="text-xs text-muted-foreground">외부 업스케일이 필요 없다면 이 단계를 건너뛸 수 있습니다.</div>
                          <Button size="sm" variant="ghost" onClick={() => { setUpscaleSkipped(true); next(); }}>건너뛰기 →</Button>
                        </div>
                      )}
                    </div>
                  )}


                  {/* ============ STEP 4: 벡터 변환 (단색 전용) ============ */}
                  {currentStep === 4 && logoType === "mono" && (
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">
                        단색 로고는 벡터(SVG)로 변환해야 인쇄·자수·레이저 공정에서 깔끔하게 출력됩니다. Vectorizer.AI를 사용합니다.
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3 items-center p-4 rounded-md border">
                        <div className="text-xs text-muted-foreground">
                          소스: {processedKind === "upscaled" ? "업스케일된 로고" : "원본 로고"} · 변환 모드는 [외주 설정]에서 변경
                        </div>
                        <Button onClick={handleVectorizeAI} disabled={!sourceLogo || !!busy}>
                          <Cloud className="w-4 h-4 mr-1" /> 벡터 변환 실행
                        </Button>
                      </div>
                      {vectorDataUrl && (
                        <div className="p-4 rounded-md border bg-emerald-50/50 dark:bg-emerald-950/20 flex items-center gap-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          <div className="flex-1 text-sm">벡터 변환 완료. 미리보기 단계에서 결과를 확인하세요.</div>
                          <Button size="sm" variant="outline" onClick={downloadVectorSvg}>SVG 다운로드</Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ============ STEP 5: 인쇄영역 · 크기 · 미리보기 · PDF (통합) ============ */}
                  {currentStep === 5 && (
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">인쇄영역(mm)·로고 크기·위치를 설정하면 우측 미리보기가 즉시 갱신됩니다. 확인 후 PDF로 다운로드하세요.</div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* LEFT: 설정 */}
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 rounded-md border bg-muted/10">
                            <div className="space-y-1 md:col-span-2">
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
                              <Input type="number" step="1" min={1} value={canvasWidthMm} onChange={(e) => { setCanvasWidthMm(Math.max(1, Number(e.target.value) || 0)); setPrintAreaSaved(false); }} className="h-9" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">인쇄영역 세로 (mm)</Label>
                              <Input type="number" step="1" min={1} value={canvasHeightMm} onChange={(e) => { setCanvasHeightMm(Math.max(1, Number(e.target.value) || 0)); setPrintAreaSaved(false); }} className="h-9" />
                            </div>
                            <Button
                              size="sm"
                              className="md:col-span-4"
                              onClick={() => {
                                try {
                                  localStorage.setItem(PRINT_AREA_LS_KEY, JSON.stringify({ w: canvasWidthMm, h: canvasHeightMm }));
                                  setPrintAreaSaved(true);
                                  toast({ title: "인쇄영역 설정이 저장되었습니다", description: `${canvasWidthMm} × ${canvasHeightMm} mm` });
                                } catch { toast({ title: "저장 실패", variant: "destructive" }); }
                              }}
                              variant={printAreaSaved ? "outline" : "default"}
                            >
                              {printAreaSaved ? <><CheckCircle2 className="w-4 h-4 mr-1" /> 인쇄영역 저장됨</> : "인쇄영역 설정 저장"}
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end p-3 rounded-md border bg-muted/20">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">로고 가로 (mm)</Label>
                                <label className="text-[10px] text-muted-foreground flex items-center gap-1 cursor-pointer">
                                  <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} className="h-3 w-3" />
                                  비율
                                </label>
                              </div>
                              <Input type="number" step="0.5" value={logoWidthMm} onChange={(e) => handleWidthChange(Number(e.target.value) || 0)} className="h-9" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">로고 세로 (mm)</Label>
                              <Input type="number" step="0.5" value={logoHeightMm} onChange={(e) => handleHeightChange(Number(e.target.value) || 0)} className="h-9" />
                            </div>
                            <div className="space-y-1 md:col-span-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">로고 크기 (영역 대비 {logoScalePct}%)</Label>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => { setOffsetXMm(0); setOffsetYMm(0); setLogoScalePct(50); }}>중앙·50%</Button>
                              </div>
                              <Slider min={1} max={100} step={1} value={[logoScalePct]} onValueChange={(v) => setLogoScalePct(v[0])} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">가로 위치 X ({clampedOffsetX.toFixed(1)} mm)</Label>
                              <Slider min={-maxOffsetX} max={maxOffsetX} step={0.5} value={[clampedOffsetX]} onValueChange={(v) => setOffsetXMm(v[0])} disabled={maxOffsetX === 0} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">세로 위치 Y ({clampedOffsetY.toFixed(1)} mm)</Label>
                              <Slider min={-maxOffsetY} max={maxOffsetY} step={0.5} value={[clampedOffsetY]} onValueChange={(v) => setOffsetYMm(v[0])} disabled={maxOffsetY === 0} />
                            </div>
                          </div>
                        </div>

                        {/* RIGHT: 미리보기 */}
                        <div className="space-y-3">
                          <div className="border rounded-md p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-semibold">인쇄영역 미리보기 (실제 비율)</div>
                              <div className="flex items-center gap-1">
                                <Badge variant="outline" className="text-[10px]">
                                  {processedKind === "original" ? "원본" : processedKind === "upscaled" ? "업스케일" : "벡터(SVG)"}
                                </Badge>
                                <Badge>{WORK_TYPES.find(w => w.value === workType)?.label}</Badge>
                              </div>
                            </div>
                            <div
                              className="w-full border-2 border-dashed border-primary/60 rounded relative overflow-hidden"
                              style={{
                                aspectRatio: `${canvasWidthMm} / ${canvasHeightMm}`,
                                background: "repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%) 50% / 16px 16px",
                              }}
                            >
                              <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-primary/20" />
                                <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/20" />
                              </div>
                              <div className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-background/80 border font-mono">
                                {canvasWidthMm} × {canvasHeightMm} mm
                              </div>
                              {displayedLogo && logoWidthMm > 0 && logoHeightMm > 0 ? (
                                <div
                                  className="absolute"
                                  style={{
                                    width: `${Math.min(100, (logoWidthMm / canvasWidthMm) * 100)}%`,
                                    height: `${Math.min(100, (logoHeightMm / canvasHeightMm) * 100)}%`,
                                    left: `calc(50% + ${(clampedOffsetX / canvasWidthMm) * 100}% - ${Math.min(100, (logoWidthMm / canvasWidthMm) * 100) / 2}%)`,
                                    top: `calc(50% + ${(clampedOffsetY / canvasHeightMm) * 100}% - ${Math.min(100, (logoHeightMm / canvasHeightMm) * 100) / 2}%)`,
                                  }}
                                >
                                  <img src={displayedLogo} alt="logo on canvas" className={`w-full h-full object-contain ${effectClass[workType]}`} referrerPolicy="no-referrer" draggable={false} />
                                </div>
                              ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-1">
                                  <ImageOff className="w-8 h-8" />
                                  <span className="text-xs">로고가 없습니다</span>
                                </div>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground space-y-0.5">
                              <div>인쇄영역: <span className="font-mono">{canvasWidthMm} × {canvasHeightMm} mm</span></div>
                              <div>로고 크기: <span className="font-mono">{logoWidthMm} × {logoHeightMm} mm</span></div>
                              <div>수량: {total} EA</div>
                            </div>
                            {processedKind !== "original" && (
                              <Button size="sm" variant="ghost" className="w-full" onClick={resetLogo}>원본 로고로 복원</Button>
                            )}
                          </div>
                        </div>
                      </div>

                      {logoType === "mono" && !vectorDataUrl && (
                        <div className="p-3 rounded-md border border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 text-xs text-amber-700 dark:text-amber-400">
                          ⚠️ 단색 로고는 벡터 변환을 완료해야 발주가 가능합니다. [벡터 변환] 단계로 돌아가서 실행하세요.
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 justify-end pt-2 border-t">
                        <Button variant="outline" onClick={() => downloadPrintPng(300)} disabled={!sourceLogo || !!busy}>
                          <Download className="w-4 h-4 mr-1" /> PNG 300dpi
                        </Button>
                        <Button variant="outline" onClick={() => downloadPrintPng(600)} disabled={!sourceLogo || !!busy}>
                          <Download className="w-4 h-4 mr-1" /> PNG 600dpi
                        </Button>
                        <Button onClick={downloadResultPdf} disabled={!sourceLogo || !!busy}>
                          <Download className="w-4 h-4 mr-1" /> 작업결과물 PDF 다운로드
                        </Button>
                      </div>
                    </div>
                  )}


                  {/* Footer: Prev / Next */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <Button variant="ghost" size="sm" onClick={prev} disabled={idx <= 0}>
                      ← 이전
                    </Button>
                    <div className="text-[11px] text-muted-foreground">
                      {currentStep === 1 && !step1Done && "로고를 업로드하세요"}
                      {currentStep === 2 && !step2Done && "로고 타입을 선택하세요"}
                      {currentStep === 3 && !step3Done && (logoType === "color" ? "업스케일을 완료하세요" : "업스케일을 실행하거나 건너뛰세요")}
                      {currentStep === 7 && !upscaledUploadName && "외부 업스케일 파일을 업로드하거나 건너뛰세요"}
                      {currentStep === 4 && !step4Done && "벡터 변환을 실행하세요"}
                      {currentStep === 5 && !step5Done && "인쇄영역 설정을 저장하세요"}
                    </div>
                    <Button size="sm" onClick={next} disabled={idx >= STEPS.length - 1 || !canAdvance(currentStep)}>
                      다음 →
                    </Button>
                  </div>
                </div>
              );
            })()}
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

type WoData = { company: string; orderNo: string; orderDate: string; deliveryDate: string; baseQty: number; surplusQty: number; totalQty: number; recipient: string; phone: string; address: string; notes: string };

function buildLogoWorkOrderHtml(
  wo: WoData,
  workType: WorkType,
  logoWidthMm: number,
  logoHeightMm: number,
  logoSrc: string | null,
  opts?: { autoPrint?: boolean },
): string {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const typeLabel = WORK_TYPES.find(w => w.value === workType)?.label || workType;
  const printScript = opts?.autoPrint ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 400));</script>` : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>作业指示书 - ${esc(wo.orderNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "PingFang SC", "Microsoft YaHei", "SimHei", "Noto Sans SC", sans-serif; color:#111; margin:0; padding:12mm; background:#fff; }
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
  @media print { .no-print { display:none; } body { padding: 0; } }
</style></head>
<body>
  ${opts?.autoPrint ? `<div class="no-print"><button onclick="window.print()">打印 / 保存PDF</button></div>` : ""}
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
  ${printScript}
</body></html>`;
}

function printLogoWorkOrder(
  wo: WoData,
  workType: WorkType,
  logoWidthMm: number,
  logoHeightMm: number,
  logoSrc: string | null,
) {
  const html = buildLogoWorkOrderHtml(wo, workType, logoWidthMm, logoHeightMm, logoSrc, { autoPrint: true });
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", description: "팝업을 허용해주세요", variant: "destructive" }); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* ====================== Order progress (3-step) ====================== */

const WECHAT_HOOKS_SHARED_KEY = "outsource.wechatWebhooks.v1";
const WECHAT_WEBHOOK_LS_KEY = "wechat.webhook.logo";

function readLogoWebhook(): string {
  try {
    const shared = localStorage.getItem(WECHAT_HOOKS_SHARED_KEY);
    if (shared) {
      const obj = JSON.parse(shared);
      if (obj?.logo) return String(obj.logo).trim();
    }
  } catch {}
  try { return (localStorage.getItem(WECHAT_WEBHOOK_LS_KEY) || "").trim(); } catch { return ""; }
}

function writeLogoWebhook(url: string) {
  const v = url.trim();
  try { localStorage.setItem(WECHAT_WEBHOOK_LS_KEY, v); } catch {}
  try {
    const raw = localStorage.getItem(WECHAT_HOOKS_SHARED_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj.logo = v;
    localStorage.setItem(WECHAT_HOOKS_SHARED_KEY, JSON.stringify(obj));
  } catch {}
}

async function renderHtmlToPdfBytes(html: string): Promise<Uint8Array> {
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
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(dataUrl, "JPEG", x, 0, imgW, imgH);
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    document.body.removeChild(iframe);
  }
}

async function buildLogoVectorPdfBytes(svgDataUrl: string, logoWidthMm: number, logoHeightMm: number): Promise<Uint8Array> {
  const svgText = svgDataUrlToText(svgDataUrl);
  const svgEl = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210, pageH = 297;
  const x = (pageW - logoWidthMm) / 2;
  const y = (pageH - logoHeightMm) / 2;
  await svg2pdf(svgEl as unknown as SVGElement, pdf, { x, y, width: logoWidthMm, height: logoHeightMm });
  return new Uint8Array(pdf.output("arraybuffer"));
}

export function LogoOrderProgressBox({
  order, wo, workType, logoWidthMm, logoHeightMm, displayedLogo, vectorDataUrl,
}: {
  order: any;
  wo: WoData;
  workType: WorkType;
  logoWidthMm: number;
  logoHeightMm: number;
  displayedLogo: string | null;
  vectorDataUrl: string | null;
}) {
  const orderNo: string = order?.external_order_id || "";
  const stateKey = `logo.progress.v1.${orderNo}`;
  const [confirmed1, setConfirmed1] = useState(false);
  const [confirmed2, setConfirmed2] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [open1, setOpen1] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string>(() => readLogoWebhook());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onFocus = () => setWebhookUrl(readLogoWebhook());
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onFocus);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("storage", onFocus); };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(stateKey);
      if (raw) {
        const s = JSON.parse(raw);
        setConfirmed1(!!s.confirmed1); setConfirmed2(!!s.confirmed2); setOrdered(!!s.ordered);
      } else {
        setConfirmed1(false); setConfirmed2(false); setOrdered(false);
      }
    } catch {}
  }, [stateKey]);

  const persist = (next: { confirmed1?: boolean; confirmed2?: boolean; ordered?: boolean }) => {
    const merged = { confirmed1, confirmed2, ordered, ...next };
    try { localStorage.setItem(stateKey, JSON.stringify(merged)); } catch {}
  };

  const saveWebhook = () => {
    writeLogoWebhook(webhookUrl);
    toast({ title: "위챗 Webhook 저장됨" });
    setSettingsOpen(false);
  };

  const woHtml = useMemo(
    () => buildLogoWorkOrderHtml(wo, workType, logoWidthMm, logoHeightMm, displayedLogo),
    [wo, workType, logoWidthMm, logoHeightMm, displayedLogo],
  );

  const sendOrder = async () => {
    if (!vectorDataUrl) {
      toast({ title: "LOGO를 먼저 변환완료하세요", description: "벡터 변환(Vectorizer.AI) 완료 후 발주가 가능합니다.", variant: "destructive" });
      return;
    }
    if (!webhookUrl) {
      toast({ title: "위챗 Webhook 미설정", description: "발주 전 위챗 Webhook을 먼저 설정하세요.", variant: "destructive" });
      setSettingsOpen(true);
      return;
    }
    setSending(true);
    try {
      const zip = new JSZip();
      const woPdfBytes = await renderHtmlToPdfBytes(woHtml);
      zip.file("작업지시서.pdf", woPdfBytes);
      const logoPdfBytes = await buildLogoVectorPdfBytes(vectorDataUrl, logoWidthMm, logoHeightMm);
      zip.file(`LOGO_${orderNo}.pdf`, logoPdfBytes);

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipName = `${orderNo}.zip`;

      const path = `orders/logo-${orderNo}-${Date.now()}.zip`;
      const { error: upErr } = await supabase.storage.from("hologram-pdf").upload(path, zipBlob, {
        contentType: "application/zip", upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("hologram-pdf").getPublicUrl(path);
      const url = pub.publicUrl;

      const message =
`【LOGO 발주】
작업번호: ${orderNo}
작업종류: ${WORK_TYPES.find(w => w.value === workType)?.label || workType}
LOGO 크기: ${logoWidthMm} × ${logoHeightMm} mm
파일: ${zipName}
다운로드: ${url}`;

      const { data, error } = await supabase.functions.invoke("wechat-send", {
        body: { webhookUrl, message },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      setOrdered(true); persist({ ordered: true });
      toast({ title: "발주 완료", description: `${zipName} 위챗 단톡방으로 전송됨` });
    } catch (e: any) {
      toast({ title: "발주 실패", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSending(false);
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
          <Step idx={1} label="작업지시서 확인" done={confirmed1} disabled={false} onClick={() => setOpen1(true)} />
          <Step idx={2} label="작업파일 확인" done={confirmed2} disabled={!confirmed1} onClick={() => setOpen2(true)} />
          <Step idx={3} label="발주" done={ordered} disabled={!confirmed1 || !confirmed2 || sending} onClick={sendOrder} />
        </div>

        <Dialog open={open1} onOpenChange={setOpen1}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader><DialogTitle>작업지시서 미리보기</DialogTitle></DialogHeader>
            <div className="flex-1 overflow-auto border rounded-md bg-white">
              <iframe title="logo-wo-preview" srcDoc={woHtml} className="w-full h-[70vh] bg-white" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen1(false)}>닫기</Button>
              <Button onClick={() => { setConfirmed1(true); persist({ confirmed1: true }); setOpen1(false); toast({ title: "작업지시서 확인 완료" }); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={open2} onOpenChange={setOpen2}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                LOGO 작업파일 미리보기 · {logoWidthMm} × {logoHeightMm} mm
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto border rounded-md bg-white p-6 flex items-center justify-center" style={{ minHeight: "60vh" }}>
              {vectorDataUrl ? (
                <img src={vectorDataUrl} alt="logo vector" className="max-w-full max-h-[60vh] object-contain" />
              ) : (
                <div className="text-center space-y-2">
                  <ImageOff className="w-10 h-10 mx-auto text-destructive" />
                  <div className="text-sm font-medium text-destructive">LOGO 벡터 변환이 완료되지 않았습니다</div>
                  <div className="text-xs text-muted-foreground">발주 전 '벡터 변환(Vectorizer.AI)'을 먼저 실행하세요.</div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen2(false)}>닫기</Button>
              <Button onClick={() => { setConfirmed2(true); persist({ confirmed2: true }); setOpen2(false); toast({ title: "작업파일 확인 완료" }); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>LOGO 공장 위챗 Webhook</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs">기업위챗 그룹봇 Webhook URL</Label>
              <Input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
              <p className="text-xs text-muted-foreground">발주 시 이 그룹채팅으로 ZIP 다운로드 링크가 전송됩니다.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>취소</Button>
              <Button onClick={saveWebhook}><Send className="w-4 h-4 mr-1" /> 저장</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function QrThumb({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 80 })
      .then(d => { if (!cancelled) setSrc(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [value]);
  return src
    ? <img src={src} alt="qr" className="w-12 h-12 border rounded bg-white" />
    : <div className="w-12 h-12 border rounded bg-muted" />;
}

