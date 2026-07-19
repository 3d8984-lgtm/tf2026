import { useEffect, useMemo, useRef, useState } from "react";
import { OrderStatusCell } from "@/components/outsource/OrderStatusCell";
import { markOrderCompleted } from "@/hooks/useOrderStatus";
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
import { ChevronLeft, Eye, Upload, FileText, X, Loader2, Download, CheckCircle2, Send, Settings, Package } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import JSZip from "jszip";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * 미리보기 HTML을 그대로 렌더링해 A4 PDF 바이트로 반환.
 * 화면 밖 iframe에 srcdoc으로 띄운 뒤 html2canvas + jsPDF로 변환.
 */
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
    // 폰트/이미지 로딩 대기
    const doc = iframe.contentDocument!;
    await (doc as any).fonts?.ready?.catch?.(() => {});
    const imgs = Array.from(doc.images);
    await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = () => r(null); })));
    await new Promise((r) => setTimeout(r, 150));

    const target = doc.body;
    const canvas = await html2canvas(target, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = 210, pageH = 297;
    // A4 한 페이지에 맞도록 비율 유지하며 축소
    const ratio = Math.min(pageW / (canvas.width), pageH / (canvas.height));
    const imgW = canvas.width * ratio;
    const imgH = canvas.height * ratio;
    const x = (pageW - imgW) / 2;
    const y = 0;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(dataUrl, "JPEG", x, y, imgW, imgH);
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    document.body.removeChild(iframe);
  }
}


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

function buildHologramWorkOrderHtml(wo: HoloWorkOrderData, pdfPreview: string | null, opts?: { autoPrint?: boolean }) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const img = pdfPreview ? `<img src="${pdfPreview}" alt="hologram" />` : `<div class="ph">未上传PDF</div>`;
  const printScript = opts?.autoPrint ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>` : "";
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
  .qty th { background:#f7f7f7; }
  .notes { min-height: 22mm; white-space: pre-wrap; }
  h2 { font-size: 12pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  .imgbox { border:1px solid #333; padding: 4mm; text-align:center; height: 80mm; display:flex; align-items:center; justify-content:center; background:#fafafa; }
  .imgbox img { max-width:100%; max-height:100%; object-fit: contain; }
  .ph { color:#999; font-size: 10pt; }
  .sig { margin-top: 10mm; display:flex; justify-content:flex-end; gap: 10mm; font-size: 10pt; }
  .sig div { border-top:1px solid #333; padding-top:2mm; min-width: 40mm; text-align:center; }
  @media print { .no-print { display:none; } body { padding: 0; } }
  .no-print { position:fixed; top:8px; right:8px; }
  .no-print button { padding: 8px 14px; font-size: 13px; cursor:pointer; }
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
  ${printScript}
</body></html>`;
}

function printHologramWorkOrder(wo: HoloWorkOrderData, pdfPreview: string | null) {
  const html = buildHologramWorkOrderHtml(wo, pdfPreview, { autoPrint: true });
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", description: "팝업을 허용해주세요", variant: "destructive" as any }); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function computeHoloWorkOrder(order: any, items: Array<{ grade: Grade }>): HoloWorkOrderData {
  const orderNo: string = order?.external_order_id || "";
  const c: Record<Grade, number> = { COMMON: 0, RARE: 0, EPIC: 0, LEGEND: 0 };
  for (const it of items) c[it.grade] = (c[it.grade] || 0) + 1;
  const defaults: HoloWorkOrderData = {
    company: "TWINMETA",
    orderNo,
    orderDate: (order?.created_at || "").slice(0, 10),
    deliveryDate: (order?.project_completed_at || "").slice(0, 10),
    common: c.COMMON, rare: c.RARE, epic: c.EPIC, legend: c.LEGEND,
    total: items.length || order?.quantity || 0,
    recipient: "TWINMETA",
    phone: "18562757070",
    address: "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
    notes: order?.source_data?.notes || order?.source_data?.memo || "",
  };
  try {
    const raw = orderNo ? localStorage.getItem(`hologram.workOrder.v1.${orderNo}`) : null;
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

function buildHologramExcelBlob(items: Array<{ seq: number; uniqueNo: string; editionNo: number; editionLabel?: string; grade: Grade }>): Blob {
  const rows = items.map(it => ({
    "序号": it.seq,
    "贴纸唯一编号": it.uniqueNo,
    "版本编号": it.editionLabel || `#${String(it.editionNo).padStart(4, "0")}`,
    "等级": it.grade,
    "公司名称": "TWINMETA",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hologram");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const WECHAT_WEBHOOK_LS_KEY = "wechat.webhook.hologram";
const WECHAT_HOOKS_SHARED_KEY = "outsource.wechatWebhooks.v1";

function readHologramWebhook(): string {
  try {
    const shared = localStorage.getItem(WECHAT_HOOKS_SHARED_KEY);
    if (shared) {
      const obj = JSON.parse(shared);
      if (obj?.hologram) return String(obj.hologram).trim();
    }
  } catch {}
  try { return (localStorage.getItem(WECHAT_WEBHOOK_LS_KEY) || "").trim(); } catch { return ""; }
}

function writeHologramWebhook(url: string) {
  const v = url.trim();
  try { localStorage.setItem(WECHAT_WEBHOOK_LS_KEY, v); } catch {}
  try {
    const raw = localStorage.getItem(WECHAT_HOOKS_SHARED_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj.hologram = v;
    localStorage.setItem(WECHAT_HOOKS_SHARED_KEY, JSON.stringify(obj));
  } catch {}
}

function OrderProgressBox({
  order, items, pdfPreview,
}: {
  order: any;
  items: Array<{ seq: number; uniqueNo: string; editionNo: number; editionLabel?: string; grade: Grade }>;
  pdfPreview: string | null;
}) {
  const orderNo: string = order?.external_order_id || "";
  const stateKey = `hologram.progress.v1.${orderNo}`;
  const [confirmed1, setConfirmed1] = useState(false);
  const [confirmed2, setConfirmed2] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [open1, setOpen1] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string>(() => readHologramWebhook());

  useEffect(() => {
    const onFocus = () => setWebhookUrl(readHologramWebhook());
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onFocus);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("storage", onFocus); };
  }, []);

  const saveWebhook = () => {
    writeHologramWebhook(webhookUrl);
    toast({ title: "위챗 Webhook 저장됨" });
    setSettingsOpen(false);
  };
  const [sending, setSending] = useState(false);

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

  const woData = useMemo(() => computeHoloWorkOrder(order, items), [order, items]);
  const woHtml = useMemo(() => buildHologramWorkOrderHtml(woData, pdfPreview), [woData, pdfPreview]);


  const sendOrder = async () => {
    if (!webhookUrl) {
      toast({ title: "위챗 Webhook 미설정", description: "발주 전 위챗 Webhook을 먼저 설정하세요.", variant: "destructive" as any });
      setSettingsOpen(true);
      return;
    }
    setSending(true);
    try {
      // Build ZIP
      const zip = new JSZip();
      // 작업지시서 PDF — 미리보기와 동일한 HTML을 PDF로 변환
      const woPdfBytes = await renderHtmlToPdfBytes(woHtml);
      zip.file("작업지시서.pdf", woPdfBytes);
      // 작업파일 Excel
      const xlsBlob = buildHologramExcelBlob(items);
      zip.file("작업파일.xlsx", new Uint8Array(await xlsBlob.arrayBuffer()));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipName = `${orderNo}.zip`;

      // Upload to public bucket to get a downloadable URL
      const path = `orders/${orderNo}-${Date.now()}.zip`;
      const { error: upErr } = await supabase.storage.from("hologram-pdf").upload(path, zipBlob, {
        contentType: "application/zip", upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("hologram-pdf").getPublicUrl(path);
      const url = pub.publicUrl;

      // Send WeChat message with download link (group bots support text/markdown; file requires media_id upload not available cross-origin)
      const message =
`【홀로그램 스티커 발주】
작업번호: ${orderNo}
수량: ${items.length}건
파일: ${zipName}
다운로드: ${url}`;

      const { data, error } = await supabase.functions.invoke("wechat-send", {
        body: { webhookUrl, message },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      setOrdered(true); persist({ ordered: true });

      // 발주 이력 기록
      try {
        await supabase.from("outsource_orders").insert({
          factory: "hologram",
          order_no: orderNo,
          product_code: order?.product_code || orderNo,
          quantity: items.length,
          ordered_at: new Date().toISOString().slice(0, 10),
          status: "ordered",
          note: `위챗 발송 · ${zipName}`,
        });
      } catch (logErr) {
        console.warn("outsource_orders insert failed", logErr);
      }

      toast({ title: "발주 완료", description: `${zipName} 위챗 단톡방으로 전송됨` });
    } catch (e: any) {
      toast({ title: "발주 실패", description: e?.message || String(e), variant: "destructive" as any });
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

        {/* Step 1 Dialog */}
        <Dialog open={open1} onOpenChange={setOpen1}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader><DialogTitle>작업지시서 미리보기</DialogTitle></DialogHeader>
            <div className="flex-1 overflow-auto border rounded-md bg-white">
              <iframe title="work-order-preview" srcDoc={woHtml} className="w-full h-[70vh] bg-white" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen1(false)}>닫기</Button>
              <Button onClick={() => { setConfirmed1(true); persist({ confirmed1: true }); setOpen1(false); toast({ title: "작업지시서 확인 완료" }); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Step 2 Dialog — Excel-like preview */}
        <Dialog open={open2} onOpenChange={setOpen2}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-green-600" />
                작업파일.xlsx · Sheet: Hologram ({items.length}행)
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto border bg-white text-[#1f2937]" style={{ fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif' }}>
              <table className="border-collapse text-xs" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col style={{ width: 60 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 140 }} />
                </colgroup>
                {/* Column letter row (A, B, C...) */}
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-20 bg-[#f3f3f3] border border-[#d4d4d4] h-6 text-center font-normal text-[#666]"></th>
                    {["A", "B", "C", "D", "E"].map(L => (
                      <th key={L} className="sticky top-0 z-10 bg-[#f3f3f3] border border-[#d4d4d4] h-6 text-center font-normal text-[#666]">{L}</th>
                    ))}
                  </tr>
                  {/* Header row (row 1) */}
                  <tr>
                    <td className="sticky left-0 z-10 bg-[#f3f3f3] border border-[#d4d4d4] h-7 text-center text-[#666]">1</td>
                    {["序号", "贴纸唯一编号", "版本编号", "等级", "公司名称"].map(h => (
                      <td key={h} className="border border-[#d4d4d4] px-2 h-7 font-semibold bg-[#fafafa]">{h}</td>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={`${it.uniqueNo}-${it.editionNo}`} className="hover:bg-[#f0f7ff]">
                      <td className="sticky left-0 bg-[#f3f3f3] border border-[#d4d4d4] h-6 text-center text-[#666]">{i + 2}</td>
                      <td className="border border-[#d4d4d4] px-2 h-6 text-right tabular-nums">{it.seq}</td>
                      <td className="border border-[#d4d4d4] px-2 h-6">{it.uniqueNo}</td>
                      <td className="border border-[#d4d4d4] px-2 h-6">{it.editionLabel || `#${String(it.editionNo).padStart(4, "0")}`}</td>
                      <td className="border border-[#d4d4d4] px-2 h-6">{it.grade}</td>
                      <td className="border border-[#d4d4d4] px-2 h-6">TWINMETA</td>
                    </tr>
                  ))}
                  {/* Empty Excel-like padding rows */}
                  {Array.from({ length: Math.max(0, 8 - items.length) }).map((_, i) => (
                    <tr key={`empty-${i}`}>
                      <td className="sticky left-0 bg-[#f3f3f3] border border-[#d4d4d4] h-6 text-center text-[#666]">{items.length + 2 + i}</td>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j} className="border border-[#d4d4d4] h-6"></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Sheet tab bar */}
            <div className="flex items-center gap-1 border-x border-b bg-[#f3f3f3] px-2 py-1 text-xs text-[#444]">
              <div className="px-3 py-0.5 bg-white border border-[#d4d4d4] border-b-white rounded-t font-medium">Hologram</div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen2(false)}>닫기</Button>
              <Button onClick={() => { setConfirmed2(true); persist({ confirmed2: true }); setOpen2(false); toast({ title: "작업파일 확인 완료" }); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* Webhook settings dialog */}
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>홀로그램 공장 위챗 Webhook</DialogTitle></DialogHeader>
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
      const individualOrderNo = (it.order_id as string) || (it.sequence_no as string) || `${idx + 1}`;
      const editionRaw = String(it.edition || "").trim();
      const editionNo = editionRaw ? parseInt(editionRaw.replace(/^#+/, ""), 10) || (idx + 1) : (idx + 1);
      const editionLabel = editionRaw
        ? (editionRaw.startsWith("#") ? editionRaw : `#${editionRaw}`)
        : `#${String(editionNo).padStart(4, "0")}`;
      const uniqueNo = `${individualOrderNo}-3`;
      const qrValue = (it.hologram_qr as string) || `${uniqueNo}-${editionNo}`;
      return {
        seq: idx + 1,
        orderNo: detailOrder.external_order_id as string,
        uniqueNo,
        editionNo,
        editionLabel,
        grade: gradeFromCode(it.grade || it.card_grade),
        qrValue,
      };
    });
  }, [detailOrder]);

  if (activeOrderNo && detailOrder) {
    const downloadExcel = () => {
      const rows = detailItems.map(it => ({
        "序号": it.seq,
        "贴纸唯一编号": it.uniqueNo,
        "版本编号": it.editionLabel,
        "等级": it.grade,
        "公司名称": "TWINMETA",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Hologram");
      XLSX.writeFile(wb, `hologram_${activeOrderNo}.xlsx`);
      toast({ title: "엑셀 다운로드 완료", description: `hologram_${activeOrderNo}.xlsx` });
    };
    return (
      <div>
        <PageHeader title={t("menu.outHologram")} description="주문 상세 목록" />
        <div className="p-6 space-y-4">
          <OrderProgressBox order={detailOrder} items={detailItems} pdfPreview={pdfPreview} />
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
                    <TableHead>회사명</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailItems.map(it => (
                    <TableRow key={`${it.uniqueNo}-${it.editionNo}`}>
                      <TableCell>{it.seq}</TableCell>
                      <TableCell className="font-mono">{it.uniqueNo}</TableCell>
                      <TableCell>{it.editionLabel}</TableCell>
                      <TableCell><Badge variant="outline">{it.grade}</Badge></TableCell>
                      <TableCell>TWINMETA</TableCell>
                    </TableRow>
                  ))}
                  {detailItems.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">—</TableCell></TableRow>
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
                  <TableHead>발주 상태</TableHead>
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
                    <TableCell><OrderStatusCell factory="hologram" orderNo={r.orderNo} /></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setActiveOrderNo(r.orderNo)}>
                        <Eye className="w-4 h-4 mr-1" /> 상세보기
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {orderRows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">—</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
