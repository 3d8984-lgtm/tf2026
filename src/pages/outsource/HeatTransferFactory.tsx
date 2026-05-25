import { useEffect, useMemo, useRef, useState } from "react";
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
import { ChevronLeft, Upload, X, Download, FileText, Loader2, QrCode as QrCodeIcon } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { toast } from "@/hooks/use-toast";
import QRCode from "qrcode";
import JSZip from "jszip";

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
async function composeClippedDesign(
  designSrc: string,
  maskCanvas: HTMLCanvasElement,
  widthPt: number,
  heightPt: number,
  dpi: number,
): Promise<HTMLCanvasElement> {
  const targetW = Math.max(64, Math.round((widthPt / 72) * dpi));
  const targetH = Math.max(64, Math.round((heightPt / 72) * dpi));

  // 1) build mask at target size, converting the PDF render into pure alpha
  const mask = document.createElement("canvas");
  mask.width = targetW;
  mask.height = targetH;
  const mctx = mask.getContext("2d")!;
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(maskCanvas, 0, 0, targetW, targetH);
  const md = mctx.getImageData(0, 0, targetW, targetH);
  for (let i = 0; i < md.data.length; i += 4) {
    const r = md.data[i], g = md.data[i + 1], b = md.data[i + 2], a = md.data[i + 3];
    // dark pixels = inside shape. Use 1 - luminance, weighted by alpha.
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const inside = (1 - lum) * (a / 255);
    md.data[i] = 0; md.data[i + 1] = 0; md.data[i + 2] = 0;
    md.data[i + 3] = Math.round(Math.min(1, inside) * 255);
  }
  mctx.putImageData(md, 0, 0);

  // 2) draw design centered, cover-fit to mask
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";

  const img = await loadImage(designSrc);
  const scale = Math.max(targetW / img.width, targetH / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (targetW - dw) / 2;
  const dy = (targetH - dh) / 2;
  octx.drawImage(img, dx, dy, dw, dh);

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

  // global outline PDF (applied to all orders unless replaced inside detail by test upload)
  const [outline, setOutline] = useState<{
    previewUrl: string;
    maskCanvas: HTMLCanvasElement;
    widthPt: number;
    heightPt: number;
    name: string;
  } | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);

  const handleOutlineUpload = async (f: File) => {
    setOutlineLoading(true);
    try {
      const buf = await readFileAsArrayBuffer(f);
      const r = await loadPdfOutline(buf);
      setOutline({ ...r, name: f.name });
      toast({ title: "외곽선 PDF 로드 완료", description: f.name });
    } catch (e: any) {
      toast({ title: "PDF 로드 실패", description: e?.message || "", variant: "destructive" });
    } finally {
      setOutlineLoading(false);
    }
  };

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const activeOrder = orders.find((o) => o.id === activeOrderId) || null;

  return (
    <div>
      <PageHeader title={t("menu.outHeatTransfer") || "열전사 디자인 공장"} description="PDF 외곽선 기반 디자인 시안 + QR코드 발주" />
      <div className="p-6 space-y-4">
        {!activeOrder ? (
          <>
            <DesignFormatBox
              outline={outline}
              loading={outlineLoading}
              onUpload={handleOutlineUpload}
              onClear={() => setOutline(null)}
            />
            <OrderListCard orders={orders} onOpen={setActiveOrderId} />
          </>
        ) : (
          <OrderDetail
            order={activeOrder}
            outline={outline}
            onBack={() => setActiveOrderId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ============ design format box ============

function DesignFormatBox({
  outline, loading, onUpload, onClear,
}: {
  outline: { previewUrl: string; widthPt: number; heightPt: number; name: string } | null;
  loading: boolean;
  onUpload: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> 디자인 포맷 설정</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-[1fr_auto] gap-4">
          <div className="space-y-2">
            <Label className="text-xs">디자인 외곽선 (PDF)</Label>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
                className="h-9"
              />
              {outline && (
                <Button size="sm" variant="outline" onClick={onClear}><X className="w-4 h-4 mr-1" /> 제거</Button>
              )}
            </div>
            {outline && (
              <div className="text-xs text-muted-foreground">
                {outline.name} · {(outline.widthPt / 72 * 25.4).toFixed(1)}×{(outline.heightPt / 72 * 25.4).toFixed(1)}mm · {outline.widthPt.toFixed(0)}×{outline.heightPt.toFixed(0)}pt
              </div>
            )}
            {!outline && (
              <p className="text-xs text-muted-foreground">PDF의 첫 페이지가 외곽선으로 사용됩니다. 어두운 영역이 디자인 영역(클리핑 마스크)으로 처리됩니다.</p>
            )}
          </div>
          <div className="flex items-center justify-center">
            <div className="w-48 h-48 rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
              {loading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> :
                outline ? <img src={outline.previewUrl} alt="외곽선" className="max-w-full max-h-full object-contain" /> :
                <span className="text-xs text-muted-foreground">미리보기 없음</span>}
            </div>
          </div>
        </div>
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
              <TableHead>트윈커</TableHead>
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

function OrderDetail({
  order, outline, onBack,
}: {
  order: OrderRow;
  outline: { previewUrl: string; maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number; name: string } | null;
  onBack: () => void;
}) {
  const details: DesignDetail[] = useMemo(() => {
    const arr: DesignDetail[] = [];
    const n = Math.max(order.items.length, 1);
    for (let i = 0; i < n; i++) {
      arr.push({
        serial: i + 1,
        orderNo: order.orderNo,
        designUid: `${order.orderNo}-${i + 1}`,
        designSrc: order.logoUrl,
      });
    }
    return arr;
  }, [order]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> 목록으로</Button>
        <h2 className="text-base font-semibold">작업번호 <span className="font-mono">{order.orderNo}</span></h2>
      </div>

      <WorkOrderInfoBox order={order} outlinePreview={outline?.previewUrl} />

      <Tabs defaultValue="design">
        <TabsList>
          <TabsTrigger value="design">디자인 시안 설정</TabsTrigger>
          <TabsTrigger value="qr">큐알코드 시안</TabsTrigger>
        </TabsList>
        <TabsContent value="design">
          <DesignTab order={order} details={details} outline={outline} />
        </TabsContent>
        <TabsContent value="qr">
          <QrTab details={details} />
        </TabsContent>
      </Tabs>

      <OrderDetailList details={details} outline={outline} />
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

function printHtWorkOrder(wo: HtWorkOrderData, outlinePreview?: string | null) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const outlineBlock = outlinePreview
    ? `<h2>设计外框(示例)</h2><div class="outline"><img src="${outlinePreview}" alt="outline" /></div>`
    : "";
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
  .qty th { background:#f7f7f7; }
  .notes { min-height: 22mm; white-space: pre-wrap; }
  h2 { font-size: 12pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  .outline { border:1px solid #333; padding: 4mm; text-align:center; }
  .outline img { max-width: 100%; max-height: 80mm; object-fit: contain; }
  .sig { margin-top: 10mm; display:flex; justify-content:flex-end; gap: 10mm; font-size: 10pt; }
  .sig div { border-top:1px solid #333; padding-top:2mm; min-width: 40mm; text-align:center; }
  @media print { .no-print { display:none; } }
  .no-print { position:fixed; top:8px; right:8px; }
  .no-print button { padding: 8px 14px; font-size: 13px; cursor:pointer; }
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
  </table>
  <h2>作业数量</h2>
  <table class="qty"><tr><th>总数量</th></tr><tr><td><strong>${esc(wo.total)}</strong></td></tr></table>
  <h2>订单特殊事项</h2>
  <table><tr><td class="notes">${esc(wo.notes) || "&nbsp;"}</td></tr></table>
  ${outlineBlock}
  <div class="sig"><div>负责人</div><div>审批</div></div>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body></html>`;
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", description: "팝업을 허용해주세요", variant: "destructive" }); return; }
  w.document.open(); w.document.write(html); w.document.close();
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
        <TxtField label="받을사람(트윈커)" v={wo.recipient} set={(v) => set({ recipient: v })} />
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
  order, details, outline,
}: {
  order: OrderRow;
  details: DesignDetail[];
  outline: { previewUrl: string; maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number; name: string } | null;
}) {
  const [testDesign, setTestDesign] = useState<string | null>(null);
  const [testName, setTestName] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dpi, setDpi] = useState(300);

  const first = details[0];
  const effectiveDesign = testDesign || first?.designSrc || null;

  // regenerate preview when inputs change (use 96dpi for screen preview)
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!outline || !effectiveDesign) { setPreviewUrl(null); return; }
      try {
        const canvas = await composeClippedDesign(effectiveDesign, outline.maskCanvas, outline.widthPt, outline.heightPt, 96);
        if (!cancelled) setPreviewUrl(canvas.toDataURL("image/png"));
      } catch (e) { /* ignore */ }
    }
    run();
    return () => { cancelled = true; };
  }, [outline, effectiveDesign]);

  const handleTestUpload = async (f: File) => {
    const url = await new Promise<string>((resolve) => {
      const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(f);
    });
    setTestDesign(url); setTestName(f.name);
  };

  const downloadOne = async (d: DesignDetail) => {
    if (!outline) { toast({ title: "외곽선 PDF를 먼저 업로드하세요", variant: "destructive" }); return; }
    const src = testDesign || d.designSrc;
    if (!src) { toast({ title: "디자인 소스가 없습니다", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const c = await composeClippedDesign(src, outline.maskCanvas, outline.widthPt, outline.heightPt, dpi);
      const b = await canvasToBlob(c);
      triggerDownload(b, `${d.designUid}_${dpi}dpi.png`);
    } finally { setBusy(false); }
  };

  const downloadAll = async () => {
    if (!outline) { toast({ title: "외곽선 PDF를 먼저 업로드하세요", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`design_${order.orderNo}_${dpi}dpi`)!;
      for (const d of details) {
        const src = testDesign || d.designSrc;
        if (!src) continue;
        const c = await composeClippedDesign(src, outline.maskCanvas, outline.widthPt, outline.heightPt, dpi);
        const b = await canvasToBlob(c);
        folder.file(`${d.designUid}.png`, b);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      triggerDownload(zipBlob, `design_${order.orderNo}_${dpi}dpi.zip`);
      toast({ title: "일괄 다운로드 완료", description: `${details.length}개` });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">디자인 시안 설정</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!outline && (
          <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
            상단의 "디자인 포맷 설정"에서 외곽선 PDF를 먼저 업로드하세요.
          </div>
        )}

        <div className="grid md:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
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
                <Button size="sm" variant="outline" onClick={() => { setTestDesign(null); setTestName(""); }}>
                  <X className="w-4 h-4 mr-1" /> {testName || "테스트 제거"}
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">업스케일 DPI</Label>
            <Input type="number" min={72} max={1200} value={dpi} onChange={(e) => setDpi(Math.max(72, Math.min(1200, Number(e.target.value) || 300)))} className="h-9 w-28" />
          </div>
          <Button size="sm" variant="outline" disabled={busy || !outline || !first} onClick={() => first && downloadOne(first)}>
            <Download className="w-4 h-4 mr-1" /> 현재 디자인
          </Button>
          <Button size="sm" disabled={busy || !outline || details.length === 0} onClick={downloadAll}>
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            일괄 다운로드
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">외곽선</div>
            <div className="w-full aspect-square rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
              {outline ? <img src={outline.previewUrl} alt="외곽선" className="max-w-full max-h-full object-contain" /> :
                <span className="text-xs text-muted-foreground">—</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              미리보기 ({first?.designUid || "—"}){testDesign ? " · 테스트 디자인" : ""}
            </div>
            <div className="w-full aspect-square rounded border bg-[conic-gradient(at_50%_50%,#eee_25%,#fff_0_50%,#eee_0_75%,#fff_0)] bg-[length:16px_16px] flex items-center justify-center overflow-hidden">
              {previewUrl ? <img src={previewUrl} alt="미리보기" className="max-w-full max-h-full object-contain" /> :
                <span className="text-xs text-muted-foreground">미리보기 없음</span>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============ QR tab ============

interface QrConfig {
  size: number;        // px
  margin: number;      // qr quiet zone modules
  textSize: number;    // px
  gap: number;         // px between qr and text
}

async function buildQrPng(value: string, cfg: QrConfig): Promise<HTMLCanvasElement> {
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, value, { width: cfg.size, margin: cfg.margin });
  const padX = 16;
  const textH = cfg.textSize + 8;
  const out = document.createElement("canvas");
  out.width = Math.max(qrCanvas.width, padX * 2 + value.length * cfg.textSize * 0.65);
  out.height = qrCanvas.height + cfg.gap + textH;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(qrCanvas, (out.width - qrCanvas.width) / 2, 0);
  ctx.fillStyle = "#000000";
  ctx.font = `${cfg.textSize}px ui-monospace, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillText(value, out.width / 2, qrCanvas.height + cfg.gap);
  return out;
}

function QrTab({ details }: { details: DesignDetail[] }) {
  const [cfg, setCfg] = useState<QrConfig>({ size: 300, margin: 2, textSize: 20, gap: 12 });
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
  }, [first?.designUid, cfg.size, cfg.margin, cfg.textSize, cfg.gap]);

  const downloadAll = async () => {
    setBusy(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`qrcode_${first?.orderNo || "order"}`)!;
      for (const d of details) {
        const c = await buildQrPng(d.designUid, cfg);
        const b = await canvasToBlob(c);
        folder.file(`${d.designUid}.png`, b);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload(blob, `qrcode_${first?.orderNo || "order"}.zip`);
      toast({ title: "QR 폴더 다운로드 완료", description: `${details.length}개` });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><QrCodeIcon className="w-4 h-4" /> 큐알코드 시안</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-4 gap-3">
          <NumField label="QR 크기 (px)" v={cfg.size} set={(v) => setCfg({ ...cfg, size: v })} min={80} max={1200} />
          <NumField label="여백 (modules)" v={cfg.margin} set={(v) => setCfg({ ...cfg, margin: v })} min={0} max={16} />
          <NumField label="텍스트 크기 (px)" v={cfg.textSize} set={(v) => setCfg({ ...cfg, textSize: v })} min={8} max={96} />
          <NumField label="QR-텍스트 간격 (px)" v={cfg.gap} set={(v) => setCfg({ ...cfg, gap: v })} min={0} max={120} />
        </div>

        <div className="grid md:grid-cols-2 gap-4 items-start">
          <div>
            <div className="text-xs text-muted-foreground mb-1">미리보기 ({first?.designUid || "—"})</div>
            <div className="rounded border bg-muted/30 p-4 flex items-center justify-center min-h-64">
              {previewUrl ? <img src={previewUrl} alt="qr" className="max-w-full max-h-[400px] object-contain" /> :
                <span className="text-xs text-muted-foreground">—</span>}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">QR 코드는 디자인 고유번호(작업번호-순번)를 값으로 사용하며, 하단에 동일한 텍스트가 표기됩니다.</p>
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

function NumField({ label, v, set, min, max }: { label: string; v: number; set: (n: number) => void; min: number; max: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={min} max={max} value={v} onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || min)))} className="h-9" />
    </div>
  );
}

// ============ order detail list ============

function OrderDetailList({
  details, outline,
}: {
  details: DesignDetail[];
  outline: { previewUrl: string; maskCanvas: HTMLCanvasElement; widthPt: number; heightPt: number; name: string } | null;
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
              <TableHead>디자인</TableHead>
              <TableHead>QR코드</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {details.map((d) => (
              <TableRow key={d.designUid}>
                <TableCell>{d.serial}</TableCell>
                <TableCell className="font-mono">{d.orderNo}</TableCell>
                <TableCell className="font-mono">{d.designUid}</TableCell>
                <TableCell><DesignThumb detail={d} outline={outline} /></TableCell>
                <TableCell><QrThumb value={d.designUid} /></TableCell>
              </TableRow>
            ))}
            {details.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">—</TableCell></TableRow>
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
