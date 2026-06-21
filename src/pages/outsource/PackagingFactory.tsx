import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Package, AlertTriangle, CheckCircle2, CircleSlash, Mail, ShoppingCart, CreditCard, Shirt, Building2,
  Eye, Save, Send, Upload, FileText, Download, Trash2, Printer, Pencil, History, Plus, Minus,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

(pdfjsLib as any).GlobalWorkerOptions.workerPort = new PdfWorker();

/**
 * 부자재(포장용품) 공장
 * - 비닐포장(카드포장지/티셔츠포장지) — 업체 A
 * - 택배봉투 — 업체 B
 */

type Vendor = "vinyl" | "mailer";
type VinylKind = "card" | "tshirt";

type InventoryRow = {
  id: string;
  vendor: Vendor;
  kind?: VinylKind;
  label: string;
  unit: string;
  in_stock: number;
  safety_stock: number;
};

type PO = {
  id: string;
  po_number: string;
  ordered_at: string;
  expected_at: string | null;
  vendor: Vendor;
  kind?: VinylKind;
  quantity: number;
  unit: string;
  status: "ordered" | "in_production" | "shipped" | "received";
  notes?: string;
};

type VendorInfo = {
  company: string;
  recipient: string;
  phone: string;
  address: string;
};

type VinylKindMeta = {
  fabric: string;
  designName: string;
  designPreview: string; // PNG data URL of PDF first page
};

const INITIAL_INVENTORY: InventoryRow[] = [
  { id: "v-card", vendor: "vinyl", kind: "card", label: "비닐포장지 - 카드용", unit: "장", in_stock: 8000, safety_stock: 10000 },
  { id: "v-tshirt", vendor: "vinyl", kind: "tshirt", label: "비닐포장지 - 티셔츠용", unit: "장", in_stock: 12000, safety_stock: 10000 },
  { id: "m-std", vendor: "mailer", label: "택배봉투 (표준)", unit: "장", in_stock: 4500, safety_stock: 5000 },
];

type StockAdjustment = {
  id: string;
  inventory_id: string;
  at: string; // ISO
  delta: number;
  after: number;
  reason: string;
};

const VENDOR_NAME: Record<Vendor, string> = {
  vinyl: "비닐포장 공장 (업체 A)",
  mailer: "택배봉투 공장 (업체 B)",
};

const VENDOR_INFO_KEY = "packaging.vendor.info.v1";
const WECHAT_KEYS_KEY = "wechat.webhook.keys.v1";
const VINYL_META_KEY = "packaging.vinyl.meta.v1";
const MAILER_SIZE_KEY = "packaging.mailer.size.v1";
const INVENTORY_KEY = "packaging.inventory.v2";
const ADJUSTMENTS_KEY = "packaging.inv.adjustments.v1";

const DEFAULT_VENDOR_INFO: Record<Vendor, VendorInfo> = {
  vinyl: { company: "", recipient: "", phone: "", address: "" },
  mailer: { company: "", recipient: "", phone: "", address: "" },
};

const DEFAULT_VINYL_META: Record<VinylKind, VinylKindMeta> = {
  card: { fabric: "", designName: "", designPreview: "" },
  tshirt: { fabric: "", designName: "", designPreview: "" },
};

function loadMailerSize(): string {
  if (typeof window === "undefined") return "";
  try { return localStorage.getItem(MAILER_SIZE_KEY) || ""; } catch { return ""; }
}

function statusInfo(stock: number, safety: number) {
  if (stock <= 0) return { key: "out", color: "bg-zinc-500", text: "text-zinc-400", label: "품절" };
  const r = safety > 0 ? stock / safety : 1;
  if (r < 0.5) return { key: "critical", color: "bg-red-500", text: "text-red-500", label: "품절 임박" };
  if (r < 1) return { key: "low", color: "bg-yellow-500", text: "text-yellow-500", label: "재고 부족" };
  return { key: "ok", color: "bg-emerald-500", text: "text-emerald-500", label: "정상" };
}

function poStatusLabel(s: PO["status"]) {
  return ({ ordered: "발주 완료", in_production: "생산 중", shipped: "발송 완료", received: "입고 완료" } as const)[s];
}

const todayStr = () => new Date().toISOString().slice(0, 10);

function loadVendorInfo(): Record<Vendor, VendorInfo> {
  if (typeof window === "undefined") return DEFAULT_VENDOR_INFO;
  try {
    const raw = localStorage.getItem(VENDOR_INFO_KEY);
    if (!raw) return DEFAULT_VENDOR_INFO;
    const p = JSON.parse(raw);
    return {
      vinyl: { ...DEFAULT_VENDOR_INFO.vinyl, ...(p.vinyl || {}) },
      mailer: { ...DEFAULT_VENDOR_INFO.mailer, ...(p.mailer || {}) },
    };
  } catch {
    return DEFAULT_VENDOR_INFO;
  }
}

function loadInventory(): InventoryRow[] {
  if (typeof window === "undefined") return INITIAL_INVENTORY;
  try {
    const raw = localStorage.getItem(INVENTORY_KEY);
    if (!raw) return INITIAL_INVENTORY;
    const parsed = JSON.parse(raw) as InventoryRow[];
    // Merge with defaults so new items appear and unit fixes apply
    return INITIAL_INVENTORY.map(def => {
      const found = parsed.find(p => p.id === def.id);
      if (!found) return def;
      return { ...def, in_stock: found.in_stock ?? def.in_stock, safety_stock: found.safety_stock ?? def.safety_stock };
    });
  } catch {
    return INITIAL_INVENTORY;
  }
}

function loadAdjustments(): StockAdjustment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ADJUSTMENTS_KEY);
    return raw ? (JSON.parse(raw) as StockAdjustment[]) : [];
  } catch { return []; }
}

function loadVinylMeta(): Record<VinylKind, VinylKindMeta> {
  if (typeof window === "undefined") return DEFAULT_VINYL_META;
  try {
    const raw = localStorage.getItem(VINYL_META_KEY);
    if (!raw) return DEFAULT_VINYL_META;
    const p = JSON.parse(raw);
    return {
      card: { ...DEFAULT_VINYL_META.card, ...(p.card || {}) },
      tshirt: { ...DEFAULT_VINYL_META.tshirt, ...(p.tshirt || {}) },
    };
  } catch {
    return DEFAULT_VINYL_META;
  }
}

async function renderPdfFirstPagePng(bytes: Uint8Array): Promise<string> {
  const doc = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.8 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
  return canvas.toDataURL("image/png");
}

function buildPoText(args: {
  vendor: Vendor; kind?: VinylKind; qty: number; unit: string;
  expectedAt: string; notes: string; info: VendorInfo; poNumber: string;
  fabric?: string; mailerSize?: string;
}) {
  const { vendor, kind, qty, unit, expectedAt, notes, info, poNumber, fabric, mailerSize } = args;
  const itemName = vendor === "vinyl"
    ? (kind === "card" ? "卡片包装袋" : "T恤包装袋")
    : "快递袋";
  const unitCn = unit === "장" ? "个" : unit;
  return [
    `📦 [TWINMETA] 采购订单 / 发货单`,
    `────────────────`,
    `订单编号: ${poNumber}`,
    `工厂: ${VENDOR_NAME[vendor]}`,
    `品名: ${itemName}`,
    fabric ? `面料: ${fabric}` : ``,
    mailerSize ? `尺寸: ${mailerSize}` : ``,
    `数量: ${qty.toLocaleString()} ${unitCn}`,
    `下单日期: ${todayStr()}`,
    `预计到货日: ${expectedAt || "-"}`,
    ``,
    `[收货信息]`,
    `公司名称: ${info.company || "-"}`,
    `收件人: ${info.recipient || "-"}`,
    `联系电话: ${info.phone || "-"}`,
    `地址: ${info.address || "-"}`,
    notes ? `\n[备注]\n${notes}` : ``,
  ].filter(Boolean).join("\n");
}

export default function PackagingFactory() {
  const [tab, setTab] = useState("inventory");
  const [inventory, setInventory] = useState<InventoryRow[]>(loadInventory);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>(loadAdjustments);
  const [adjustTarget, setAdjustTarget] = useState<InventoryRow | null>(null);
  const [pos, setPos] = useState<PO[]>([]);

  // PO form state
  const [vendor, setVendor] = useState<Vendor>("vinyl");
  const [vinylKind, setVinylKind] = useState<VinylKind>("card");
  const [qty, setQty] = useState<number>(10000);
  const [expectedAt, setExpectedAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Vendor base info (persistent)
  const [vendorInfo, setVendorInfo] = useState<Record<Vendor, VendorInfo>>(loadVendorInfo);

  // Vinyl per-kind meta (fabric + design preview), persistent
  const [vinylMeta, setVinylMeta] = useState<Record<VinylKind, VinylKindMeta>>(loadVinylMeta);

  // Mailer size (persistent)
  const [mailerSize, setMailerSize] = useState<string>(loadMailerSize);

  // Preview dialog
  const [previewOpen, setPreviewOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const a4Ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem(VINYL_META_KEY, JSON.stringify(vinylMeta)); } catch {}
  }, [vinylMeta]);

  useEffect(() => {
    try { localStorage.setItem(MAILER_SIZE_KEY, mailerSize); } catch {}
  }, [mailerSize]);

  useEffect(() => {
    try { localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory)); } catch {}
  }, [inventory]);

  useEffect(() => {
    try { localStorage.setItem(ADJUSTMENTS_KEY, JSON.stringify(adjustments)); } catch {}
  }, [adjustments]);

  const unitOf = (v: Vendor, k?: VinylKind) => {
    if (v === "mailer") return "장";
    return "장";
  };
  const minQtyOf = (v: Vendor, k?: VinylKind) => {
    if (v === "vinyl" && k === "card") return 10000;
    if (v === "vinyl" && k === "tshirt") return 10000;
    return 1;
  };

  const onVendorChange = (v: Vendor) => {
    setVendor(v);
    setQty(minQtyOf(v, v === "vinyl" ? vinylKind : undefined));
  };
  const onKindChange = (k: VinylKind) => {
    setVinylKind(k);
    setQty(minQtyOf("vinyl", k));
  };

  const kpi = useMemo(() => {
    let ok = 0, low = 0, critical = 0, out = 0;
    for (const i of inventory) {
      const k = statusInfo(i.in_stock, i.safety_stock).key;
      if (k === "ok") ok++; else if (k === "low") low++; else if (k === "critical") critical++; else out++;
    }
    return { ok, low, critical, out };
  }, [inventory]);

  const vinylRows = inventory.filter(i => i.vendor === "vinyl");
  const mailerRows = inventory.filter(i => i.vendor === "mailer");

  const goPurchase = (row: InventoryRow) => {
    setVendor(row.vendor);
    if (row.vendor === "vinyl" && row.kind) {
      setVinylKind(row.kind);
      setQty(minQtyOf("vinyl", row.kind));
    } else {
      setQty(minQtyOf(row.vendor));
    }
    setTab("create");
  };

  const updateSafety = (id: string, val: number) => {
    setInventory(prev => prev.map(r => r.id === id ? { ...r, safety_stock: val } : r));
  };

  const setStockExact = (id: string, val: number, reason: string) => {
    const row = inventory.find(r => r.id === id);
    if (!row) return;
    const next = Math.max(0, Math.floor(val));
    const delta = next - row.in_stock;
    setInventory(prev => prev.map(r => r.id === id ? { ...r, in_stock: next } : r));
    if (delta !== 0) {
      setAdjustments(prev => [
        { id: crypto.randomUUID(), inventory_id: id, at: new Date().toISOString(), delta, after: next, reason },
        ...prev,
      ].slice(0, 200));
    }
  };

  const applyAdjustment = (id: string, delta: number, reason: string) => {
    const row = inventory.find(r => r.id === id);
    if (!row) return;
    const next = Math.max(0, row.in_stock + Math.floor(delta));
    setInventory(prev => prev.map(r => r.id === id ? { ...r, in_stock: next } : r));
    setAdjustments(prev => [
      { id: crypto.randomUUID(), inventory_id: id, at: new Date().toISOString(), delta: next - row.in_stock, after: next, reason },
      ...prev,
    ].slice(0, 200));
  };

  const updateVendorInfo = (v: Vendor, patch: Partial<VendorInfo>) => {
    setVendorInfo(prev => ({ ...prev, [v]: { ...prev[v], ...patch } }));
  };

  const saveVendorInfo = (v: Vendor) => {
    const next = { ...vendorInfo };
    localStorage.setItem(VENDOR_INFO_KEY, JSON.stringify(next));
    toast({ title: "기본정보 저장됨", description: VENDOR_NAME[v] });
  };

  const updateVinylMeta = (k: VinylKind, patch: Partial<VinylKindMeta>) => {
    setVinylMeta(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }));
  };

  const onUploadDesign = async (k: VinylKind, file: File) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast({ title: "PDF 파일만 업로드 가능합니다", variant: "destructive" });
      return;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const png = await renderPdfFirstPagePng(buf);
      updateVinylMeta(k, { designName: file.name, designPreview: png });
      toast({ title: "시안 업로드 완료", description: file.name });
    } catch (e) {
      toast({ title: "PDF 처리 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const clearDesign = (k: VinylKind) => {
    updateVinylMeta(k, { designName: "", designPreview: "" });
  };

  const currentPreviewNumber = `PKG-${new Date().getFullYear()}-${String(pos.length + 1).padStart(4, "0")}`;
  const currentKind = vendor === "vinyl" ? vinylKind : undefined;
  const currentUnit = unitOf(vendor, currentKind);
  const currentFabric = vendor === "vinyl" ? vinylMeta[vinylKind].fabric : undefined;
  const currentDesignPreview = vendor === "vinyl" ? vinylMeta[vinylKind].designPreview : "";
  const currentMailerSize = vendor === "mailer" ? mailerSize : undefined;
  const previewText = buildPoText({
    vendor, kind: currentKind, qty, unit: currentUnit,
    expectedAt, notes, info: vendorInfo[vendor], poNumber: currentPreviewNumber,
    fabric: currentFabric, mailerSize: currentMailerSize,
  });

  const sendWechat = async (vKey: Vendor, text: string) => {
    try {
      const raw = localStorage.getItem(WECHAT_KEYS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const key = parsed[vKey];
      if (!key) {
        toast({
          title: "위챗 키 미설정",
          description: `외주 생산 > 시스템 설정에서 ${vKey} 채널 키를 등록하세요.`,
          variant: "destructive",
        });
        return;
      }
      const webhookUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`;
      const { data, error } = await supabase.functions.invoke("wechat-send", {
        body: { webhookUrl, message: text },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "위챗 발송 성공", description: VENDOR_NAME[vKey] });
    } catch (e) {
      toast({
        title: "위챗 발송 실패",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  /** Render the A4 preview element to a single-page A4 PDF Blob. */
  const generatePdfBlob = async (): Promise<Blob | null> => {
    const el = a4Ref.current;
    if (!el) return null;
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
    return pdf.output("blob");
  };

  const downloadPdf = async () => {
    setGenerating(true);
    try {
      // ensure preview is mounted
      const wasOpen = previewOpen;
      if (!wasOpen) setPreviewOpen(true);
      // wait for render
      await new Promise(r => setTimeout(r, 200));
      const blob = await generatePdfBlob();
      if (!blob) {
        toast({ title: "미리보기가 준비되지 않았습니다", variant: "destructive" });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentPreviewNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF 다운로드", description: `${currentPreviewNumber}.pdf` });
    } catch (e) {
      toast({ title: "PDF 생성 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const printPdf = async () => {
    setGenerating(true);
    try {
      if (!previewOpen) setPreviewOpen(true);
      await new Promise(r => setTimeout(r, 200));
      const blob = await generatePdfBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) {
        w.addEventListener("load", () => {
          try { w.print(); } catch {}
        });
      }
    } catch (e) {
      toast({ title: "출력 실패", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const submitPo = async () => {
    const min = minQtyOf(vendor, currentKind);
    if (!qty || qty < min) {
      toast({
        title: "최소 주문 수량 미달",
        description: `${vendor === "vinyl" ? (vinylKind === "card" ? "카드포장지" : "티셔츠포장지") : "택배봉투"} 최소 주문은 ${min}${currentUnit} 입니다.`,
        variant: "destructive",
      });
      return;
    }
    const id = crypto.randomUUID();
    const po: PO = {
      id,
      po_number: currentPreviewNumber,
      ordered_at: todayStr(),
      expected_at: expectedAt || null,
      vendor,
      kind: currentKind,
      quantity: qty,
      unit: currentUnit,
      status: "ordered",
      notes,
    };
    setPos(prev => [po, ...prev]);
    toast({ title: "발주 등록됨", description: `${po.po_number} · ${qty}${currentUnit}` });

    // Generate PDF and trigger download
    try {
      if (!previewOpen) setPreviewOpen(true);
      await new Promise(r => setTimeout(r, 200));
      const blob = await generatePdfBlob();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${po.po_number}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {}

    // Send text summary to WeChat (PDF is downloaded for manual attachment)
    const text = buildPoText({
      vendor, kind: currentKind, qty, unit: currentUnit,
      expectedAt, notes, info: vendorInfo[vendor], poNumber: po.po_number,
      fabric: currentFabric, mailerSize: currentMailerSize,
    });
    await sendWechat(vendor, text);

    setNotes("");
    setExpectedAt("");
    setPreviewOpen(false);
    setTab("inventory");
  };

  const changePoStatus = (id: string, next: PO["status"]) => {
    setPos(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (next === "received" && p.status !== "received") {
        const target = inventory.find(r => r.vendor === p.vendor && (p.vendor !== "vinyl" || r.kind === p.kind));
        if (target) {
          applyAdjustment(target.id, p.quantity, `발주 입고 (${p.po_number})`);
        }
      }
      return { ...p, status: next };
    }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" /> 부자재(포장용품) 공장
          </h1>
          <p className="text-sm text-muted-foreground">비닐포장 · 택배봉투 재고 현황 및 발주 관리</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inventory">재고 현황 & 발주 목록</TabsTrigger>
          <TabsTrigger value="create">발주 지시</TabsTrigger>
        </TabsList>

        {/* ============ 재고현황 & 발주목록 ============ */}
        <TabsContent value="inventory" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiTile icon={<CheckCircle2 className="w-5 h-5" />} label="정상" value={kpi.ok} color="text-emerald-500" dot="bg-emerald-500" />
            <KpiTile icon={<AlertTriangle className="w-5 h-5" />} label="재고 부족" value={kpi.low} color="text-yellow-500" dot="bg-yellow-500" />
            <KpiTile icon={<AlertTriangle className="w-5 h-5" />} label="품절 임박" value={kpi.critical} color="text-red-500" dot="bg-red-500" />
            <KpiTile icon={<CircleSlash className="w-5 h-5" />} label="품절" value={kpi.out} color="text-zinc-400" dot="bg-zinc-500" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="w-4 h-4" /> {VENDOR_NAME.vinyl}
                <Badge variant="outline" className="ml-2">비닐포장</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InventoryTable
                rows={vinylRows}
                renderKind={(r) => r.kind === "card"
                  ? <span className="inline-flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> 카드포장지</span>
                  : <span className="inline-flex items-center gap-1"><Shirt className="w-3.5 h-3.5" /> 티셔츠포장지</span>}
                onSafetyChange={updateSafety}
                onStockChange={(id, val) => setStockExact(id, val, "수동 수정")}
                onAdjust={(r) => setAdjustTarget(r)}
                onPurchase={goPurchase}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="w-4 h-4" /> {VENDOR_NAME.mailer}
                <Badge variant="outline" className="ml-2">택배봉투</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InventoryTable
                rows={mailerRows}
                renderKind={() => <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> 택배봉투</span>}
                onSafetyChange={updateSafety}
                onStockChange={(id, val) => setStockExact(id, val, "수동 수정")}
                onAdjust={(r) => setAdjustTarget(r)}
                onPurchase={goPurchase}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">발주 목록</CardTitle>
            </CardHeader>
            <CardContent>
              {pos.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">등록된 발주가 없습니다.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>발주번호</TableHead>
                      <TableHead>발주일</TableHead>
                      <TableHead>예상 입고일</TableHead>
                      <TableHead>공장</TableHead>
                      <TableHead>품목</TableHead>
                      <TableHead className="text-right">수량</TableHead>
                      <TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pos.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.po_number}</TableCell>
                        <TableCell>{p.ordered_at}</TableCell>
                        <TableCell>{p.expected_at ?? "-"}</TableCell>
                        <TableCell>{VENDOR_NAME[p.vendor]}</TableCell>
                        <TableCell>
                          {p.vendor === "vinyl"
                            ? (p.kind === "card" ? "카드포장지" : "티셔츠포장지")
                            : "택배봉투"}
                        </TableCell>
                        <TableCell className="text-right">{p.quantity.toLocaleString()} {p.unit}</TableCell>
                        <TableCell>
                          <Select value={p.status} onValueChange={(v) => changePoStatus(p.id, v as PO["status"])}>
                            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ordered">{poStatusLabel("ordered")}</SelectItem>
                              <SelectItem value="in_production">{poStatusLabel("in_production")}</SelectItem>
                              <SelectItem value="shipped">{poStatusLabel("shipped")}</SelectItem>
                              <SelectItem value="received">{poStatusLabel("received")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ 발주 지시 ============ */}
        <TabsContent value="create" className="space-y-6">
          {/* 공장별 기본정보 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(["vinyl", "mailer"] as Vendor[]).map(v => (
              <Card key={v}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> {VENDOR_NAME[v]} 기본정보
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>발주업체명</Label>
                      <Input
                        value={vendorInfo[v].company}
                        onChange={(e) => updateVendorInfo(v, { company: e.target.value })}
                        placeholder="업체명"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>받는 사람</Label>
                      <Input
                        value={vendorInfo[v].recipient}
                        onChange={(e) => updateVendorInfo(v, { recipient: e.target.value })}
                        placeholder="담당자명"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>전화번호</Label>
                      <Input
                        value={vendorInfo[v].phone}
                        onChange={(e) => updateVendorInfo(v, { phone: e.target.value })}
                        placeholder="+86-138-0000-0000"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>주소</Label>
                      <Input
                        value={vendorInfo[v].address}
                        onChange={(e) => updateVendorInfo(v, { address: e.target.value })}
                        placeholder="배송 주소"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => saveVendorInfo(v)} className="gap-1">
                      <Save className="w-3.5 h-3.5" /> 저장
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">발주 공장 선택</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <VendorPickCard
                  active={vendor === "vinyl"}
                  onClick={() => onVendorChange("vinyl")}
                  icon={<Package className="w-5 h-5" />}
                  title="비닐포장 발주"
                  desc="카드포장지 / 티셔츠포장지 (업체 A)"
                />
                <VendorPickCard
                  active={vendor === "mailer"}
                  onClick={() => onVendorChange("mailer")}
                  icon={<Mail className="w-5 h-5" />}
                  title="택배봉투 발주"
                  desc="택배 발송용 봉투 (업체 B)"
                />
              </div>
            </CardContent>
          </Card>

          {/* 비닐포장: 원단/시안 (카드 + 티셔츠) */}
          {vendor === "vinyl" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">비닐포장 — 원단 / 시안 설정</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(["card", "tshirt"] as VinylKind[]).map(k => (
                    <DesignFabricBlock
                      key={k}
                      kind={k}
                      meta={vinylMeta[k]}
                      onChangeFabric={(val) => updateVinylMeta(k, { fabric: val })}
                      onUpload={(f) => onUploadDesign(k, f)}
                      onClear={() => clearDesign(k)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {vendor === "vinyl" ? "비닐포장 발주서" : "택배봉투 발주서"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {vendor === "vinyl" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <KindPickCard
                    active={vinylKind === "card"}
                    onClick={() => onKindChange("card")}
                    icon={<CreditCard className="w-5 h-5" />}
                    title="카드포장지"
                    desc="최소 주문 10,000 장"
                  />
                  <KindPickCard
                    active={vinylKind === "tshirt"}
                    onClick={() => onKindChange("tshirt")}
                    icon={<Shirt className="w-5 h-5" />}
                    title="티셔츠포장지"
                    desc="최소 주문 10,000 장"
                  />
                </div>
              )}

              {vendor === "mailer" && (
                <div className="space-y-1.5">
                  <Label>택배봉투 사이즈</Label>
                  <Input
                    value={mailerSize}
                    onChange={(e) => setMailerSize(e.target.value)}
                    placeholder="예: 25 × 35 cm (W × H)"
                  />
                  <p className="text-xs text-muted-foreground">발주서에 사양으로 포함됩니다. 입력값은 자동 저장됩니다.</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>수량</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={minQtyOf(vendor, currentKind)}
                      value={qty}
                      onChange={(e) => setQty(Number(e.target.value) || 0)}
                    />
                    <span className="text-sm text-muted-foreground w-10">
                      {currentUnit}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    최소: {minQtyOf(vendor, currentKind).toLocaleString()} {currentUnit}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>예상 입고일</Label>
                  <Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>발주일</Label>
                  <Input type="date" value={todayStr()} disabled />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>비고</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="요청사항을 입력해주세요"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 flex-wrap">
                <Button variant="outline" onClick={() => setTab("inventory")}>취소</Button>
                <Button variant="outline" onClick={() => setPreviewOpen(true)} className="gap-1">
                  <Eye className="w-4 h-4" /> 발주서 미리보기 (A4)
                </Button>
                <Button onClick={submitPo} className="gap-1" disabled={generating}>
                  <ShoppingCart className="w-4 h-4" /> 발주 등록 (PDF + 위챗)
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Preview Dialog — A4 출력 미리보기 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[900px] max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>발주서 미리보기 (A4) — {VENDOR_NAME[vendor]}</DialogTitle>
          </DialogHeader>

          <div className="bg-muted/40 p-4 rounded-md overflow-auto flex justify-center">
            <A4OrderSheet
              ref={a4Ref}
              poNumber={currentPreviewNumber}
              vendor={vendor}
              vendorName={VENDOR_NAME[vendor]}
              kind={currentKind}
              qty={qty}
              unit={currentUnit}
              fabric={currentFabric || ""}
              designPreview={currentDesignPreview}
              designName={vendor === "vinyl" ? vinylMeta[vinylKind].designName : ""}
              orderedAt={todayStr()}
              expectedAt={expectedAt}
              info={vendorInfo[vendor]}
              notes={notes}
              mailerSize={currentMailerSize || ""}
            />
          </div>

          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>닫기</Button>
            <Button variant="outline" className="gap-1" onClick={printPdf} disabled={generating}>
              <Printer className="w-4 h-4" /> A4 출력
            </Button>
            <Button variant="outline" className="gap-1" onClick={downloadPdf} disabled={generating}>
              <Download className="w-4 h-4" /> PDF 다운로드
            </Button>
            <Button
              variant="outline"
              className="gap-1"
              onClick={() => sendWechat(vendor, previewText)}
            >
              <Send className="w-4 h-4" /> 위챗으로 보내기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StockAdjustDialog
        target={adjustTarget}
        history={adjustments.filter(a => adjustTarget && a.inventory_id === adjustTarget.id).slice(0, 10)}
        onClose={() => setAdjustTarget(null)}
        onApply={(delta, reason) => {
          if (!adjustTarget) return;
          applyAdjustment(adjustTarget.id, delta, reason);
          setAdjustTarget(null);
        }}
      />
    </div>
  );
}

/* ============================================================
 * A4 발주서 (210 × 297 mm)
 * ============================================================ */
type A4OrderSheetProps = {
  poNumber: string;
  vendor: Vendor;
  vendorName: string;
  kind?: VinylKind;
  qty: number;
  unit: string;
  fabric: string;
  designPreview: string;
  designName: string;
  orderedAt: string;
  expectedAt: string;
  info: VendorInfo;
  notes: string;
  mailerSize: string;
};

const A4OrderSheet = forwardRef<HTMLDivElement, A4OrderSheetProps>(function A4OrderSheet({
  poNumber, vendor, vendorName, kind, qty, unit, fabric, designPreview, designName,
  orderedAt, expectedAt, info, notes, mailerSize,
}, ref) {

    const itemName = vendor === "vinyl"
      ? (kind === "card" ? "卡片包装袋" : "T恤包装袋")
      : "快递袋";
    const unitCn = unit === "장" ? "个" : unit;
    const spec = vendor === "vinyl" ? (fabric || "-") : (mailerSize || "-");
    return (
      <div
        ref={ref}
        style={{
          width: "210mm",
          minHeight: "297mm",
          padding: "16mm 14mm",
          background: "#ffffff",
          color: "#111111",
          fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
          fontSize: "11pt",
          lineHeight: 1.45,
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #111", paddingBottom: 10 }}>
          <div>
            <div style={{ fontSize: "10pt", letterSpacing: 2, color: "#666" }}>TWINMETA FACTORY</div>
            <h1 style={{ fontSize: "26pt", fontWeight: 800, margin: "4px 0 0" }}>采 购 订 单</h1>
          </div>
          <div style={{ textAlign: "right", fontSize: "10pt" }}>
            <div><b>订单编号</b> {poNumber}</div>
            <div><b>下单日期</b> {orderedAt}</div>
            <div><b>预计到货</b> {expectedAt || "-"}</div>
          </div>
        </div>

        {/* Vendor + Recipient */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <Block title="供应工厂">
            <Kv k="工厂名称" v={vendorName} />
          </Block>
          <Block title="收货信息">
            <Kv k="公司名称" v={info.company || "-"} />
            <Kv k="收件人" v={info.recipient || "-"} />
            <Kv k="联系电话" v={info.phone || "-"} />
            <Kv k="收货地址" v={info.address || "-"} />
          </Block>
        </div>

        {/* Item table */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: "12pt", marginBottom: 6 }}>订购品项</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10.5pt" }}>
            <thead>
              <tr style={{ background: "#f1f1f1" }}>
                <th style={tdHead}>序号</th>
                <th style={tdHead}>品名</th>
                <th style={tdHead}>{vendor === "vinyl" ? "面料 / 规格" : "尺寸 / 规格"}</th>
                <th style={tdHead}>数量</th>
                <th style={tdHead}>单位</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}>1</td>
                <td style={td}>{itemName}</td>
                <td style={td}>{spec}</td>
                <td style={{ ...td, textAlign: "right" }}>{qty.toLocaleString()}</td>
                <td style={td}>{unitCn}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Design preview */}
        {vendor === "vinyl" && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: "12pt", marginBottom: 6 }}>
              设计稿 {designName ? <span style={{ fontWeight: 400, color: "#666", fontSize: "10pt" }}>· {designName}</span> : null}
            </div>
            <div style={{
              border: "1px solid #ddd",
              padding: 8,
              minHeight: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fafafa",
            }}>
              {designPreview ? (
                <img
                  src={designPreview}
                  alt="design preview"
                  style={{ maxWidth: "100%", maxHeight: "80mm", objectFit: "contain" }}
                  crossOrigin="anonymous"
                />
              ) : (
                <div style={{ color: "#999", fontSize: "10pt" }}>上传设计稿 PDF 后将在此显示。</div>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: "12pt", marginBottom: 6 }}>备注</div>
          <div style={{ border: "1px solid #ddd", padding: 10, minHeight: 60, whiteSpace: "pre-wrap" }}>
            {notes || "-"}
          </div>
        </div>

        {/* Signatures */}
        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <SignBox title="下单方" />
          <SignBox title="收件确认" />
        </div>

        <div style={{ marginTop: 18, textAlign: "center", color: "#999", fontSize: "9pt", borderTop: "1px solid #eee", paddingTop: 8 }}>
          TWINMETA FACTORY · 包装材料采购订单
        </div>
      </div>
    );
});


const td: React.CSSProperties = { border: "1px solid #ccc", padding: "8px 10px", verticalAlign: "middle" };
const tdHead: React.CSSProperties = { ...td, fontWeight: 700, textAlign: "left" };

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #ddd", padding: 10 }}>
      <div style={{ fontWeight: 700, fontSize: "10.5pt", marginBottom: 6, color: "#333" }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 6, fontSize: "10.5pt", padding: "3px 0" }}>
      <div style={{ color: "#666" }}>{k}</div>
      <div>{v}</div>
    </div>
  );
}

function SignBox({ title }: { title: string }) {
  return (
    <div style={{ border: "1px solid #ddd", padding: 10, minHeight: 70 }}>
      <div style={{ fontSize: "10pt", color: "#666", marginBottom: 6 }}>{title}</div>
      <div style={{ borderBottom: "1px solid #999", height: 30 }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9pt", color: "#888", marginTop: 4 }}>
        <span>签字</span>
        <span>日期</span>
      </div>
    </div>
  );
}

/* ============================================================
 * Reusable presentational components
 * ============================================================ */
function KpiTile({ icon, label, value, color, dot }: { icon: React.ReactNode; label: string; value: number; color: string; dot: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
        <div className={color}>{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function InventoryTable({
  rows, renderKind, onSafetyChange, onStockChange, onAdjust, onPurchase,
}: {
  rows: InventoryRow[];
  renderKind: (r: InventoryRow) => React.ReactNode;
  onSafetyChange: (id: string, val: number) => void;
  onStockChange: (id: string, val: number) => void;
  onAdjust: (r: InventoryRow) => void;
  onPurchase: (r: InventoryRow) => void;
}) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground py-4 text-center">항목이 없습니다.</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>품목</TableHead>
          <TableHead className="w-44">현재 재고</TableHead>
          <TableHead className="w-40">안전 재고</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="text-right">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => {
          const s = statusInfo(r.in_stock, r.safety_stock);
          return (
            <TableRow key={r.id}>
              <TableCell>
                <div className="font-medium">{renderKind(r)}</div>
                <div className="text-xs text-muted-foreground">{r.label}</div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={r.in_stock}
                    onChange={(e) => onStockChange(r.id, Number(e.target.value) || 0)}
                    className="h-8 font-mono"
                  />
                  <span className="text-xs text-muted-foreground">{r.unit}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={r.safety_stock}
                    onChange={(e) => onSafetyChange(r.id, Number(e.target.value) || 0)}
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">{r.unit}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${s.color}`} />
                  <span className={`text-sm ${s.text}`}>{s.label}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => onAdjust(r)} className="gap-1">
                    <Pencil className="w-3.5 h-3.5" /> 재고 조정
                  </Button>
                  <Button size="sm" onClick={() => onPurchase(r)}>
                    <ShoppingCart className="w-3.5 h-3.5 mr-1" /> 발주하기
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function VendorPickCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-lg border transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
    >
      <div className="flex items-center gap-3">
        <div className={active ? "text-primary" : "text-muted-foreground"}>{icon}</div>
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
    </button>
  );
}

function KindPickCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-md border transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
    >
      <div className="flex items-center gap-2">
        <div className={active ? "text-primary" : "text-muted-foreground"}>{icon}</div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
    </button>
  );
}

function DesignFabricBlock({
  kind, meta, onChangeFabric, onUpload, onClear,
}: {
  kind: VinylKind;
  meta: VinylKindMeta;
  onChangeFabric: (v: string) => void;
  onUpload: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const title = kind === "card" ? "카드포장지" : "티셔츠포장지";
  const icon = kind === "card" ? <CreditCard className="w-4 h-4" /> : <Shirt className="w-4 h-4" />;
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 font-medium">
        {icon} {title}
      </div>
      <div className="space-y-1.5">
        <Label>원단 종류</Label>
        <Input
          value={meta.fabric}
          onChange={(e) => onChangeFabric(e.target.value)}
          placeholder={kind === "card" ? "예: OPP 30µ 투명" : "예: LDPE 50µ 무광"}
        />
      </div>
      <div className="space-y-1.5">
        <Label>시안 파일 (PDF)</Label>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} className="gap-1">
            <Upload className="w-3.5 h-3.5" /> PDF 업로드
          </Button>
          {meta.designPreview && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} className="gap-1 text-destructive">
              <Trash2 className="w-3.5 h-3.5" /> 제거
            </Button>
          )}
        </div>
        {meta.designName && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <FileText className="w-3 h-3" /> {meta.designName}
          </div>
        )}
        <div className="border rounded-md bg-muted/30 h-48 flex items-center justify-center overflow-hidden">
          {meta.designPreview ? (
            <img src={meta.designPreview} alt={`${title} 시안`} className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="text-xs text-muted-foreground">시안 미리보기 없음</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StockAdjustDialog({
  target, history, onClose, onApply,
}: {
  target: InventoryRow | null;
  history: StockAdjustment[];
  onClose: () => void;
  onApply: (delta: number, reason: string) => void;
}) {
  const [mode, setMode] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState<string>("");

  useEffect(() => {
    if (target) {
      setMode("in");
      setAmount(0);
      setReason("");
    }
  }, [target?.id]);

  if (!target) return null;
  const delta = mode === "in" ? amount : -amount;
  const after = Math.max(0, target.in_stock + delta);

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" /> 재고 조정 — {target.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm flex justify-between">
            <span className="text-muted-foreground">현재 재고</span>
            <span className="font-mono font-semibold">{target.in_stock.toLocaleString()} {target.unit}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === "in" ? "default" : "outline"}
              onClick={() => setMode("in")}
              className="gap-1"
            >
              <Plus className="w-4 h-4" /> 입고 / 추가
            </Button>
            <Button
              type="button"
              variant={mode === "out" ? "default" : "outline"}
              onClick={() => setMode("out")}
              className="gap-1"
            >
              <Minus className="w-4 h-4" /> 출고 / 차감
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>수량</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="text-sm text-muted-foreground w-10">{target.unit}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>사유</Label>
            <Textarea
              rows={2}
              placeholder="예: 실사 차이, 파손, 샘플 사용 등"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="rounded-md border px-3 py-2 text-sm flex justify-between">
            <span className="text-muted-foreground">조정 후 재고</span>
            <span className="font-mono font-semibold">
              {after.toLocaleString()} {target.unit}
              <span className={`ml-2 text-xs ${delta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                ({delta >= 0 ? "+" : ""}{delta.toLocaleString()})
              </span>
            </span>
          </div>

          {history.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">최근 조정 이력</div>
              <div className="max-h-40 overflow-auto rounded-md border divide-y">
                {history.map(h => (
                  <div key={h.id} className="px-2 py-1.5 text-xs flex justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-muted-foreground">{new Date(h.at).toLocaleString()}</div>
                      <div className="truncate">{h.reason || "-"}</div>
                    </div>
                    <div className="text-right font-mono">
                      <div className={h.delta >= 0 ? "text-emerald-500" : "text-red-500"}>
                        {h.delta >= 0 ? "+" : ""}{h.delta.toLocaleString()}
                      </div>
                      <div className="text-muted-foreground">→ {h.after.toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button
            onClick={() => {
              if (amount <= 0) {
                toast({ title: "수량을 입력해주세요", variant: "destructive" });
                return;
              }
              if (!reason.trim()) {
                toast({ title: "사유를 입력해주세요", variant: "destructive" });
                return;
              }
              onApply(delta, reason.trim());
            }}
          >
            조정 적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
