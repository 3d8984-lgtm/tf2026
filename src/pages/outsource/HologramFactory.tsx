import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
(pdfjsLib as any).GlobalWorkerOptions.workerPort = new PdfWorker();
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, Eye, Upload, FileText, X, Loader2, Download } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import QRCode from "qrcode";

async function renderPdfFirstPagePng(bytes: Uint8Array): Promise<string> {
  const doc = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas.toDataURL("image/png");
}

type Grade = "COMMON" | "RARE" | "EPIC" | "LEGEND";
const GRADES: Grade[] = ["COMMON", "RARE", "EPIC", "LEGEND"];

function fmtDate(v?: string | null) {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v).slice(0, 10); }
}

function gradeFromCode(code?: string): Grade {
  const c = (code || "").toUpperCase();
  if (c === "L") return "LEGEND";
  if (c === "E") return "EPIC";
  if (c === "R") return "RARE";
  if (c === "C") return "COMMON";
  if ((GRADES as string[]).includes(c)) return c as Grade;
  return "COMMON";
}

function TxtField({ label, v, set, type = "text" }: { label: string; v: string; set: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={v} onChange={e => set(e.target.value)} className="h-9" />
    </div>
  );
}

interface HoloWorkOrderData {
  company: string; orderNo: string; orderDate: string; deliveryDate: string;
  common: number; rare: number; epic: number; legend: number; total: number;
  recipient: string; phone: string; address: string; notes: string;
}

function printHologramWorkOrder(wo: HoloWorkOrderData, pdfPreview: string | null) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const img = pdfPreview ? `<img src="${pdfPreview}" alt="hologram" />` : `<div class="ph">未上传PDF</div>`;
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
  .imgbox { border:1px solid #333; padding: 4mm; text-align:center; height: 80mm; display:flex; align-items:center; justify-content:center; background:#fafafa; }
  .imgbox img { max-width:100%; max-height:100%; object-fit: contain; }
  .ph { color:#999; font-size: 10pt; }
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
  <h2>各等级数量</h2>
  <table class="qty">
    <tr><th>COMMON</th><th>RARE</th><th>EPIC</th><th>LEGEND</th><th>总数量</th></tr>
    <tr><td>${esc(wo.common)}</td><td>${esc(wo.rare)}</td><td>${esc(wo.epic)}</td><td>${esc(wo.legend)}</td><td><strong>${esc(wo.total)}</strong></td></tr>
  </table>
  <h2>订单特殊事项</h2>
  <table><tr><td class="notes">${esc(wo.notes) || "&nbsp;"}</td></tr></table>
  <h2>全息贴纸样式</h2>
  <div class="imgbox">${img}</div>
  <div class="sig"><div>负责人</div><div>审批</div></div>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body></html>`;
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", description: "팝업을 허용해주세요", variant: "destructive" as any }); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function HologramWorkOrderBox({
  order, items, pdfPreview,
}: {
  order: any;
  items: Array<{ grade: Grade }>;
  pdfPreview: string | null;
}) {
  const orderNo: string = order?.external_order_id || "";
  const WO_LS_KEY = `hologram.workOrder.v1.${orderNo}`;
  const gradeCounts = useMemo(() => {
    const c: Record<Grade, number> = { COMMON: 0, RARE: 0, EPIC: 0, LEGEND: 0 };
    for (const it of items) c[it.grade] = (c[it.grade] || 0) + 1;
    return c;
  }, [items]);
  const defaults = useMemo<HoloWorkOrderData>(() => ({
    company: "TWINMETA",
    orderNo,
    orderDate: (order?.created_at || "").slice(0, 10),
    deliveryDate: (order?.project_completed_at || "").slice(0, 10),
    common: gradeCounts.COMMON,
    rare: gradeCounts.RARE,
    epic: gradeCounts.EPIC,
    legend: gradeCounts.LEGEND,
    total: items.length || order?.quantity || 0,
    recipient: "TWINMETA",
    phone: "18562757070",
    address: "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
    notes: order?.source_data?.notes || order?.source_data?.memo || "",
  }), [order, items, gradeCounts, orderNo]);
  const [wo, setWo] = useState<HoloWorkOrderData>(defaults);
  useEffect(() => {
    try {
      const raw = orderNo ? localStorage.getItem(WO_LS_KEY) : null;
      if (raw) setWo({ ...defaults, ...JSON.parse(raw) });
      else setWo(defaults);
    } catch { setWo(defaults); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo]);
  const set = (p: Partial<HoloWorkOrderData>) => setWo(prev => ({ ...prev, ...p }));
  const total = (Number(wo.common) || 0) + (Number(wo.rare) || 0) + (Number(wo.epic) || 0) + (Number(wo.legend) || 0);

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>작업지시서 설정</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={() => {
              try {
                localStorage.setItem(WO_LS_KEY, JSON.stringify({ ...wo, total }));
                toast({ title: "작업지시서 저장됨" });
              } catch (e: any) { toast({ title: "저장 실패", description: e?.message, variant: "destructive" as any }); }
            }}>저장</Button>
            <Button size="sm" variant="outline" onClick={() => printHologramWorkOrder({ ...wo, total }, pdfPreview)}>
              <FileText className="w-4 h-4 mr-1" />작업지시서 출력
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TxtField label="발주업체명" v={wo.company} set={v => set({ company: v })} />
        <TxtField label="작업번호" v={wo.orderNo} set={v => set({ orderNo: v })} />
        <div className="grid grid-cols-2 gap-2">
          <TxtField label="발주일" type="date" v={wo.orderDate} set={v => set({ orderDate: v })} />
          <TxtField label="납품일" type="date" v={wo.deliveryDate} set={v => set({ deliveryDate: v })} />
        </div>
        <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-5 gap-2">
          <TxtField label="COMMON" type="number" v={String(wo.common)} set={v => set({ common: Number(v) || 0 })} />
          <TxtField label="RARE" type="number" v={String(wo.rare)} set={v => set({ rare: Number(v) || 0 })} />
          <TxtField label="EPIC" type="number" v={String(wo.epic)} set={v => set({ epic: Number(v) || 0 })} />
          <TxtField label="LEGEND" type="number" v={String(wo.legend)} set={v => set({ legend: Number(v) || 0 })} />
          <div className="space-y-1">
            <Label className="text-xs">총수량</Label>
            <Input value={total} readOnly className="h-9 font-mono bg-muted/50" />
          </div>
        </div>
        <TxtField label="받을사람" v={wo.recipient} set={v => set({ recipient: v })} />
        <TxtField label="전화번호" v={wo.phone} set={v => set({ phone: v })} />
        <TxtField label="주소" v={wo.address} set={v => set({ address: v })} />
        <div className="md:col-span-3 space-y-1">
          <Label className="text-xs">발주특이사항</Label>
          <Textarea value={wo.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder="특이사항을 입력하세요" />
        </div>
      </CardContent>
    </Card>
  );
}

function QrThumb({ value }: { value: string }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 0, width: 96 }).then(s => {
      if (alive) setSrc(s);
    });
    return () => { alive = false; };
  }, [value]);
  if (!src) return <div className="w-10 h-10 bg-muted rounded" />;
  return <img src={src} alt={value} className="w-10 h-10" />;
}

export default function HologramFactory() {
  const { t } = useLang();
  const { data: ordersData } = useOrders();
  const [activeOrderNo, setActiveOrderNo] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfSize, setPdfSize] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const PDF_BUCKET = "hologram-pdf";
  const PDF_PATH = "format.pdf";

  const loadStoredPdf = async () => {
    const { data: list } = await supabase.storage.from(PDF_BUCKET).list("", { limit: 100 });
    const meta = list?.find((f) => f.name === PDF_PATH);
    if (!meta) { setPdfPreview(null); setPdfName(null); setPdfSize(null); return; }
    const { data: blob, error } = await supabase.storage.from(PDF_BUCKET).download(PDF_PATH);
    if (error || !blob) { setPdfPreview(null); return; }
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const dataUrl = await renderPdfFirstPagePng(buf);
      setPdfPreview(dataUrl);
      setPdfName((meta.metadata as any)?.originalName || PDF_PATH);
      setPdfSize((meta.metadata as any)?.size ?? blob.size ?? null);
    } catch (e: any) {
      toast({ title: "PDF 미리보기 실패", description: e.message, variant: "destructive" as any });
      setPdfPreview(null);
    }
  };

  useEffect(() => { loadStoredPdf(); }, []);

  const onPdfSelected = async (f?: File | null) => {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "PDF 파일만 업로드 가능합니다", variant: "destructive" as any });
      return;
    }
    setUploading(true);
    const { error } = await supabase.storage.from(PDF_BUCKET).upload(PDF_PATH, f, {
      upsert: true,
      contentType: "application/pdf",
    });
    setUploading(false);
    if (error) {
      toast({ title: "업로드 실패", description: error.message, variant: "destructive" as any });
      return;
    }
    toast({ title: "PDF 업로드 완료", description: f.name });
    await loadStoredPdf();
  };

  const onDeletePdf = async () => {
    setUploading(true);
    const { error } = await supabase.storage.from(PDF_BUCKET).remove([PDF_PATH]);
    setUploading(false);
    if (error) {
      toast({ title: "삭제 실패", description: error.message, variant: "destructive" as any });
      return;
    }
    setPdfPreview(null); setPdfName(null); setPdfSize(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast({ title: "PDF 삭제 완료" });
  };




  const orderRows = useMemo(() => {
    const list = (ordersData || []) as any[];
    return list.map((o, idx) => {
      const items: any[] = Array.isArray(o.source_data?.items) ? o.source_data.items : [];
      const qty = o.quantity || items.length || 0;
      return {
        seq: idx + 1,
        orderNo: o.external_order_id as string,
        receivedAt: fmtDate(o.created_at),
        dueDate: fmtDate(o.project_completed_at),
        twinker: (o.source_data?.twinker as string) || o.recipient_name || "",
        qty,
      };
    }).sort((a, b) => a.orderNo.localeCompare(b.orderNo)).map((r, i) => ({ ...r, seq: i + 1 }));
  }, [ordersData]);

  const detailOrder = useMemo(() => {
    if (!activeOrderNo) return null;
    return ((ordersData || []) as any[]).find(o => o.external_order_id === activeOrderNo) || null;
  }, [activeOrderNo, ordersData]);

  const detailItems = useMemo(() => {
    if (!detailOrder) return [];
    const items: any[] = Array.isArray(detailOrder.source_data?.items) ? detailOrder.source_data.items : [];
    const qty = detailOrder.quantity || items.length || 1;
    const count = Math.max(items.length, qty);
    return Array.from({ length: count }, (_, idx) => {
      const it = items[idx] || {};
      const editionNo = idx + 1;
      const uniqueNo = `${detailOrder.external_order_id}-3`;
      const qrValue = (it.hologram_qr as string) || `${uniqueNo}-${editionNo}`;
      return {
        seq: editionNo,
        orderNo: detailOrder.external_order_id as string,
        uniqueNo,
        editionNo,
        grade: gradeFromCode(it.card_grade),
        qrValue,
      };
    });
  }, [detailOrder]);

  if (activeOrderNo && detailOrder) {
    const downloadExcel = () => {
      const rows = detailItems.map(it => ({
        "순번": it.seq,
        "스티커 고유번호": it.uniqueNo,
        "에디션 넘버": `#${String(it.editionNo).padStart(4, "0")}`,
        "등급": it.grade,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 10 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Hologram");
      XLSX.writeFile(wb, `hologram_${activeOrderNo}.xlsx`);
      toast({ title: "엑셀 다운로드 완료", description: `hologram_${activeOrderNo}.xlsx` });
    };
    return (
      <div>
        <PageHeader title={t("menu.outHologram")} description="주문 상세 목록" />
        <div className="p-6 space-y-4">
          <HologramWorkOrderBox order={detailOrder} items={detailItems} pdfPreview={pdfPreview} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setActiveOrderNo(null)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> 목록으로
                </Button>
                <CardTitle className="text-base">
                  작업번호 <span className="font-mono">{activeOrderNo}</span> · {detailItems.length}건
                </CardTitle>
              </div>
              <Button size="sm" variant="outline" onClick={downloadExcel} disabled={detailItems.length === 0}>
                <Download className="w-4 h-4 mr-1" /> 작업파일 다운로드 (Excel)
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">순번</TableHead>
                    <TableHead>스티커 고유번호</TableHead>
                    <TableHead>에디션 넘버</TableHead>
                    <TableHead>등급</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailItems.map(it => (
                    <TableRow key={`${it.uniqueNo}-${it.editionNo}`}>
                      <TableCell>{it.seq}</TableCell>
                      <TableCell className="font-mono">{it.uniqueNo}</TableCell>
                      <TableCell>#{String(it.editionNo).padStart(4, "0")}</TableCell>
                      <TableCell><Badge variant="outline">{it.grade}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {detailItems.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground">—</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("menu.outHologram")} description="홀로그램 스티커 주문 목록" />
      <div className="p-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" /> PDF 설정
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => onPdfSelected(e.target.files?.[0])}
            />
            <div
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); onPdfSelected(e.dataTransfer.files?.[0]); }}
              onClick={() => { if (!uploading) fileInputRef.current?.click(); }}
              className="cursor-pointer rounded-md border border-dashed border-border bg-muted/30 hover:bg-muted/50 transition-colors p-6 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : <Upload className="w-5 h-5 text-muted-foreground" />}
                {pdfPreview ? (
                  <div className="text-sm">
                    <div className="font-medium">{pdfName}</div>
                    <div className="text-xs text-muted-foreground">
                      {pdfSize ? `${(pdfSize / 1024).toFixed(1)} KB · ` : ""}서버에 저장됨
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    PDF 포맷 파일을 드래그하거나 클릭하여 업로드하세요.
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {pdfPreview && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={uploading}
                    onClick={(e) => { e.stopPropagation(); onDeletePdf(); }}
                  >
                    <X className="w-4 h-4 mr-1" /> 삭제
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={uploading} onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                  <Upload className="w-4 h-4 mr-1" /> {pdfPreview ? "변경" : "파일 선택"}
                </Button>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">미리보기</div>
              {pdfPreview ? (
                <div className="w-full rounded-md border border-border bg-background p-2 flex items-center justify-center">
                  <img src={pdfPreview} alt="PDF 미리보기" className="max-w-full h-auto" />
                </div>
              ) : (
                <div className="w-full h-[200px] rounded-md border border-dashed border-border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">
                  업로드된 PDF가 없습니다.
                </div>
              )}
            </div>
          </CardContent>
        </Card>


        <Card>
          <CardHeader><CardTitle className="text-base">주문 목록</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">순번</TableHead>
                  <TableHead>작업번호</TableHead>
                  <TableHead>주문접수일</TableHead>
                  <TableHead>납기일</TableHead>
                  <TableHead>트윈커</TableHead>
                  <TableHead>작업수량</TableHead>
                  <TableHead className="w-28 text-right">상세보기</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderRows.map(r => (
                  <TableRow key={r.orderNo}>
                    <TableCell>{r.seq}</TableCell>
                    <TableCell>
                      <button className="font-mono text-primary hover:underline" onClick={() => setActiveOrderNo(r.orderNo)}>
                        {r.orderNo}
                      </button>
                    </TableCell>
                    <TableCell>{r.receivedAt}</TableCell>
                    <TableCell>{r.dueDate}</TableCell>
                    <TableCell>{r.twinker}</TableCell>
                    <TableCell>{r.qty}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setActiveOrderNo(r.orderNo)}>
                        <Eye className="w-4 h-4 mr-1" /> 상세보기
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {orderRows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">—</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
