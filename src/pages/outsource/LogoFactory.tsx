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
import { Eye, ImageOff, ChevronLeft, FileText, Download, Sparkles, Wand2, Upload, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
// @ts-ignore - no types
import ImageTracer from "imagetracerjs";

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
  const [logoWidthMm, setLogoWidthMm] = useState<number>(DEFAULT_BASE_MM);
  const [logoHeightMm, setLogoHeightMm] = useState<number>(DEFAULT_BASE_MM);
  const [lockAspect, setLockAspect] = useState<boolean>(true);
  const [naturalAspect, setNaturalAspect] = useState<number>(1); // width / height
  const [processedDataUrl, setProcessedDataUrl] = useState<string | null>(null); // upscaled or vectorized
  const [processedKind, setProcessedKind] = useState<"original" | "upscaled" | "vector">("original");
  type VectorPreset = "auto" | "high-res" | "smooth-curve" | "sharp-edge" | "mono-line";
  const [vectorPreset, setVectorPreset] = useState<VectorPreset>("auto");
  const [autoAnalysis, setAutoAnalysis] = useState<null | { colors: number; edgeDensity: number; sharpness: number; baseline: VectorPreset; ltres: number; qtres: number; pathomit: number; blurMul: number; targetPx: number; numberofcolors: number }>(null);
  const VECTOR_PRESETS: Record<VectorPreset, { label: string; desc: string; targetPx: number; blurMul: number; opts: Record<string, unknown> }> = {
    "auto": {
      label: "자동 최적화 (로고 분석)",
      desc: "엣지/색상/선명도를 분석해 매개변수를 자동 산출",
      targetPx: 2600,
      blurMul: 0.8,
      opts: {},
    },
    "high-res": {
      label: "고해상도 (색상 풍부)",
      desc: "원본 색상/디테일을 최대한 보존 · 컬러 로고 권장",
      targetPx: 3200,
      blurMul: 0.4,
      opts: { numberofcolors: 12, colorquantcycles: 5, mincolorratio: 0.005, ltres: 0.4, qtres: 0.4, pathomit: 6, blurradius: 1, blurdelta: 18, rightangleenhance: true, linefilter: false, roundcoords: 2 },
    },
    "smooth-curve": {
      label: "부드러운 곡선",
      desc: "계단현상 제거 · 둥근 형태/필기체 로고 권장",
      targetPx: 2400,
      blurMul: 1.0,
      opts: { numberofcolors: 4, colorquantcycles: 3, mincolorratio: 0.02, ltres: 1.2, qtres: 1.2, pathomit: 24, blurradius: 4, blurdelta: 28, rightangleenhance: false, linefilter: true, roundcoords: 1 },
    },
    "sharp-edge": {
      label: "선명한 경계",
      desc: "각진 형태/직선 보존 · 텍스트/엠블럼 로고 권장",
      targetPx: 2800,
      blurMul: 0.2,
      opts: { numberofcolors: 3, colorquantcycles: 4, mincolorratio: 0.01, ltres: 0.2, qtres: 0.2, pathomit: 10, blurradius: 0, blurdelta: 20, rightangleenhance: true, linefilter: false, roundcoords: 2 },
    },
    "mono-line": {
      label: "흑백 단색 (실루엣)",
      desc: "2색 단순화 · 자수/열전사 단색 작업 최적",
      targetPx: 2400,
      blurMul: 0.8,
      opts: { numberofcolors: 2, colorquantcycles: 3, mincolorratio: 0.05, ltres: 1.0, qtres: 1.0, pathomit: 20, blurradius: 3, blurdelta: 24, rightangleenhance: false, linefilter: true, roundcoords: 1 },
    },
  };
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

  useEffect(() => {
    setProcessedDataUrl(null);
    setProcessedKind("original");
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
    if (testLogoInputRef.current) testLogoInputRef.current.value = "";
    toast({ title: "테스트 로고 제거됨", description: "원본 로고로 복원되었습니다" });
  };

  const handleUpscale = async () => {
    if (!sourceLogo) return;
    setBusy("로고 업스케일링 중...");
    try {
      const src = sourceLogo!;
      const dataUrl = src.startsWith("data:") ? src : await fetchAsDataUrl(src);
      const img = await loadImage(dataUrl);
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setProcessedDataUrl(canvas.toDataURL("image/png"));
      setProcessedKind("upscaled");
      toast({ title: "업스케일 완료", description: `${img.naturalWidth}×${img.naturalHeight} → ${canvas.width}×${canvas.height}` });
    } catch (e: any) {
      toast({ title: "업스케일 실패", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Analyze logo image to derive optimal tracer parameters.
  // Returns ltres/qtres/pathomit/blurMul/numberofcolors plus a chosen baseline label.
  const analyzeLogoForVector = (img: HTMLImageElement) => {
    // Downsample to a small canvas for fast analysis
    const ANALYSIS_MAX = 256;
    const ar = img.naturalWidth / img.naturalHeight;
    const aw = ar >= 1 ? ANALYSIS_MAX : Math.round(ANALYSIS_MAX * ar);
    const ah = ar >= 1 ? Math.round(ANALYSIS_MAX / ar) : ANALYSIS_MAX;
    const c = document.createElement("canvas");
    c.width = aw; c.height = ah;
    const cx = c.getContext("2d")!;
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    // Composite onto white so transparent pixels do not skew luminance
    cx.fillStyle = "#ffffff";
    cx.fillRect(0, 0, aw, ah);
    cx.drawImage(img, 0, 0, aw, ah);
    const { data } = cx.getImageData(0, 0, aw, ah);
    const total = aw * ah;

    // 1) Unique color count via 5-bit per channel bucketing (alpha-weighted)
    const colorBuckets = new Set<number>();
    const lum = new Float32Array(total);
    let opaqueCount = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const a = data[i + 3];
      if (a < 16) { lum[p] = -1; continue; }
      opaqueCount++;
      const r = data[i] >> 3, g = data[i + 1] >> 3, b = data[i + 2] >> 3;
      colorBuckets.add((r << 10) | (g << 5) | b);
      lum[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    const colors = colorBuckets.size;

    // 2) Edge density + sharpness via simple gradient (Sobel-ish)
    let edgeCount = 0;
    let gradSum = 0;
    let gradSqSum = 0;
    let gradN = 0;
    const EDGE_THRESH = 32;
    for (let y = 1; y < ah - 1; y++) {
      for (let x = 1; x < aw - 1; x++) {
        const p = y * aw + x;
        if (lum[p] < 0) continue;
        const gx = Math.abs((lum[p + 1] >= 0 ? lum[p + 1] : lum[p]) - (lum[p - 1] >= 0 ? lum[p - 1] : lum[p]));
        const gy = Math.abs((lum[p + aw] >= 0 ? lum[p + aw] : lum[p]) - (lum[p - aw] >= 0 ? lum[p - aw] : lum[p]));
        const g = gx + gy;
        gradSum += g; gradSqSum += g * g; gradN++;
        if (g > EDGE_THRESH) edgeCount++;
      }
    }
    const edgeDensity = gradN > 0 ? edgeCount / gradN : 0;        // 0..1
    const gradMean = gradN > 0 ? gradSum / gradN : 0;
    const gradStd = gradN > 0 ? Math.sqrt(Math.max(0, gradSqSum / gradN - gradMean * gradMean)) : 0;
    const sharpness = Math.min(1, gradStd / 80);                  // 0..1, higher = crisper

    // 3) Derive parameters
    //   - colors: limit by detected palette, never below 2
    //   - sharp logos → low ltres/qtres, low blur, more pathomit if very busy
    //   - smooth logos → high ltres/qtres, more blur
    const numberofcolors = Math.min(12, Math.max(2, colors > 64 ? 10 : colors > 24 ? 6 : colors > 8 ? 4 : Math.max(2, colors)));
    // ltres/qtres: 0.2 (very sharp) → 1.4 (very smooth). Inverse of sharpness.
    const ltres = +(0.2 + (1 - sharpness) * 1.2).toFixed(2);
    const qtres = ltres;
    // blurMul: skip blur on sharp images, increase on aliased/smooth ones
    const blurMul = +(Math.max(0, (1 - sharpness) * 1.2 - edgeDensity * 0.4)).toFixed(2);
    // pathomit: drop more tiny artifacts when image is busy/noisy
    const pathomit = Math.round(8 + edgeDensity * 60);            // 8..68
    // targetPx: small logos need more upscaling
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    const targetPx = maxSide < 400 ? 3000 : maxSide < 1000 ? 2600 : 2200;

    // baseline label
    let baseline: VectorPreset = "smooth-curve";
    if (numberofcolors <= 2) baseline = "mono-line";
    else if (sharpness > 0.55 && numberofcolors <= 4) baseline = "sharp-edge";
    else if (numberofcolors >= 8) baseline = "high-res";

    return { colors, edgeDensity, sharpness, baseline, ltres, qtres, pathomit, blurMul, targetPx, numberofcolors };
  };

  const handleVectorize = async () => {
    if (!sourceLogo) return;
    setBusy("벡터 변환 중...");
    try {
      const src = sourceLogo;
      const dataUrl = src.startsWith("data:") ? src : await fetchAsDataUrl(src);
      const img = await loadImage(dataUrl);

      const preset = VECTOR_PRESETS[vectorPreset];

      // Resolve effective tracer options (auto = analyze + override)
      let targetPx = preset.targetPx;
      let blurMul = preset.blurMul;
      let opts: Record<string, unknown> = { ...preset.opts };
      let resolvedLabel = preset.label;

      if (vectorPreset === "auto") {
        const a = analyzeLogoForVector(img);
        setAutoAnalysis(a);
        // Seed from the closest baseline preset, then apply analysis-derived overrides
        const baseOpts = { ...VECTOR_PRESETS[a.baseline].opts } as Record<string, unknown>;
        opts = {
          ...baseOpts,
          numberofcolors: a.numberofcolors,
          ltres: a.ltres,
          qtres: a.qtres,
          pathomit: a.pathomit,
          // sharper images → keep right-angle enhancement + skip linefilter
          rightangleenhance: a.sharpness > 0.45,
          linefilter: a.sharpness <= 0.45,
          // blurradius (tracer-internal) scales with computed blur strength
          blurradius: Math.round(Math.max(0, blurMul * 4)),
        };
        targetPx = a.targetPx;
        blurMul = a.blurMul;
        resolvedLabel = `자동 (기준=${VECTOR_PRESETS[a.baseline].label.split(" ")[0]})`;
      }

      // 1) Upscale so the tracer has many samples per edge
      const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = Math.max(2, Math.min(8, Math.ceil(targetPx / Math.max(1, maxSide))));
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;

      const upCanvas = document.createElement("canvas");
      upCanvas.width = w;
      upCanvas.height = h;
      const upCtx = upCanvas.getContext("2d")!;
      upCtx.imageSmoothingEnabled = true;
      upCtx.imageSmoothingQuality = "high";
      upCtx.drawImage(img, 0, 0, w, h);

      // 2) Optional pre-blur (strength from preset or analysis)
      const blurPx = Math.max(0, blurMul * scale);
      let sourceCanvas: HTMLCanvasElement = upCanvas;
      if (blurPx > 0.1) {
        const blurCanvas = document.createElement("canvas");
        blurCanvas.width = w;
        blurCanvas.height = h;
        const blurCtx = blurCanvas.getContext("2d")!;
        (blurCtx as any).filter = `blur(${blurPx}px)`;
        blurCtx.drawImage(upCanvas, 0, 0);
        (blurCtx as any).filter = "none";
        sourceCanvas = blurCanvas;
      }

      const imageData = sourceCanvas.getContext("2d")!.getImageData(0, 0, w, h);

      // 3) Trace
      const svgString: string = ImageTracer.imagedataToSVG(imageData, {
        ...opts,
        strokewidth: 0,
        scale: 1 / scale,
        viewbox: true,
      } as any);
      const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
      setProcessedDataUrl(svgDataUrl);
      setProcessedKind("vector");
      toast({ title: "벡터 변환 완료", description: `${resolvedLabel} 프리셋으로 변환되었습니다.` });
    } catch (e: any) {
      toast({ title: "벡터 변환 실패", description: e.message, variant: "destructive" });
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
      // Background swatch matching effect preview
      pdf.setFillColor(bg);
      pdf.rect(x - 2, y - 2, logoWidthMm + 4, logoHeightMm + 4, "F");
      pdf.setDrawColor(80);
      pdf.rect(x - 2, y - 2, logoWidthMm + 4, logoHeightMm + 4);
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
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadVectorSvg}
                  disabled={processedKind !== "vector" || !!busy}
                  title={processedKind !== "vector" ? "먼저 '벡터 변환'을 실행하세요" : "확대해도 깨지지 않는 SVG 벡터 파일"}
                >
                  <Download className="w-4 h-4 mr-1" /> SVG 벡터 다운로드
                </Button>
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


            {/* Settings row */}
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
                <div className="flex items-center justify-between">
                  <Label className="text-xs">가로 (mm)</Label>
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
                <Label className="text-xs">세로 (mm)</Label>
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
              <div className="space-y-1">
                <Label className="text-xs">업스케일 (2×)</Label>
                <Button size="sm" variant="outline" className="w-full h-9" onClick={handleUpscale} disabled={!sourceLogo || !!busy}>
                  <Sparkles className="w-3 h-3 mr-1" /> 실행
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">벡터 변환</Label>
                <Button size="sm" variant="outline" className="w-full h-9" onClick={handleVectorize} disabled={!sourceLogo || !!busy}>
                  <Wand2 className="w-3 h-3 mr-1" /> 실행
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">벡터 품질 프리셋</Label>
                <Select value={vectorPreset} onValueChange={(v) => setVectorPreset(v as typeof vectorPreset)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VECTOR_PRESETS) as Array<keyof typeof VECTOR_PRESETS>).map((k) => (
                      <SelectItem key={k} value={k}>
                        <span className="font-medium">{VECTOR_PRESETS[k].label}</span>
                        <span className="text-muted-foreground"> — {VECTOR_PRESETS[k].desc}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-[10px] text-muted-foreground md:max-w-[280px]">
                현재: <span className="font-medium text-foreground">{VECTOR_PRESETS[vectorPreset].label}</span><br />
                {VECTOR_PRESETS[vectorPreset].desc}
                {vectorPreset === "auto" && autoAnalysis && (
                  <div className="mt-1 rounded border bg-muted/40 p-1.5 font-mono text-[10px] leading-snug text-foreground/80">
                    분석결과 · 색상≈{autoAnalysis.numberofcolors} · 엣지밀도 {(autoAnalysis.edgeDensity * 100).toFixed(1)}% · 선명도 {(autoAnalysis.sharpness * 100).toFixed(0)}%<br />
                    ltres={autoAnalysis.ltres} · qtres={autoAnalysis.qtres} · pathomit={autoAnalysis.pathomit} · blur×{autoAnalysis.blurMul}
                  </div>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              ※ 프리셋을 선택한 뒤 '벡터 변환'을 실행하세요. 결과가 마음에 들지 않으면 다른 프리셋으로 다시 변환할 수 있습니다. PDF는 벡터 변환 상태에서 벡터 경로를 그대로 임베드합니다.
            </p>

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
                  <div className="text-sm font-semibold">최종 적용효과 미리보기</div>
                  <Badge>{WORK_TYPES.find(w => w.value === workType)?.label}</Badge>
                </div>
                <div className="aspect-square w-full border rounded flex items-center justify-center overflow-hidden relative"
                  style={{ background: workType === "heat-transfer" ? "#1f2937" : workType === "embroidery" ? "#f3eee0" : workType === "laser" ? "#9ca3af" : "#fff" }}>
                  {displayedLogo ? (
                    <div className="relative flex items-center justify-center" style={{ width: `${Math.min(80, logoWidthMm * 1.2)}%`, height: `${Math.min(80, logoHeightMm * 1.2)}%` }}>
                      <img
                        src={displayedLogo}
                        alt="effect preview"
                        className={`max-w-full max-h-full object-contain ${effectClass[workType]}`}
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">로고 없음</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  적용 크기: {logoWidthMm} × {logoHeightMm} mm · 수량: {total} EA
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

                {processedKind !== "vector" ? (
                  <div className="text-xs text-muted-foreground p-3 rounded bg-muted/30">
                    ※ 비교를 위해서 먼저 '벡터 변환'을 실행하세요. 현재는 원본만 표시됩니다.
                  </div>
                ) : null}

                {/* Viewer */}
                {compareMode === "side" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <CompareTile label="원본" src={sourceLogo} zoom={compareZoom} origin={compareOrigin} onMove={setCompareOrigin} bg={compareBg} />
                    <CompareTile label="벡터 변환" src={processedKind === "vector" ? (processedDataUrl || sourceLogo) : sourceLogo} zoom={compareZoom} origin={compareOrigin} onMove={setCompareOrigin} bg={compareBg} muted={processedKind !== "vector"} />
                  </div>
                ) : (
                  <CompareOverlay
                    original={sourceLogo}
                    processed={processedKind === "vector" ? processedDataUrl : null}
                    zoom={compareZoom}
                    origin={compareOrigin}
                    onMove={setCompareOrigin}
                    sliderPct={sliderPct}
                    onSliderChange={setSliderPct}
                    bg={compareBg}
                  />
                )}
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
