import { useEffect, useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
(pdfjsLib as any).GlobalWorkerOptions.workerPort = new PdfWorker();

async function renderPdfFirstPagePng(bytes: Uint8Array): Promise<{ dataUrl: string; aspect: number }> {
  const doc = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return {
    dataUrl: canvas.toDataURL("image/png"),
    aspect: viewport.width / viewport.height,
  };
}
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Download, Eye, FileText, AlertTriangle, Loader2, QrCode, Upload, X } from "lucide-react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

interface Row {
  orderNo: string;
  uniqueNo: string; // orderNo + "-1"
  recipient: string;
  product: string;
  grade: Grade;
  svgUrl: string | null;
  status: "ok" | "no-svg" | "duplicate" | "no-template";
}

const MM = 2.8346456693; // 1mm in pt

function findSvgUrl(o: any): string | null {
  const candidates = [
    o.twincode_svg_url,
    o.source_data?.twincode_svg_url,
    o.source_data?.twin_code_svg_url,
    o.source_data?.svg_url,
    o.source_data?.twincode_url,
  ];
  for (const c of candidates) if (typeof c === "string" && c.trim()) return c;
  return null;
}

async function svgUrlToPng(url: string, sizePx: number): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SVG fetch failed: ${url}`);
  const svgText = await res.text();
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Image decode failed"));
      i.src = objUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, sizePx, sizePx);
    // preserve aspect, center
    const ar = (img.width || 1) / (img.height || 1);
    let w = sizePx, h = sizePx;
    if (ar > 1) h = sizePx / ar; else w = sizePx * ar;
    ctx.drawImage(img, (sizePx - w) / 2, (sizePx - h) / 2, w, h);
    const dataUrl = canvas.toDataURL("image/png");
    const bin = atob(dataUrl.split(",")[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function placeholderSvgPng(text: string, sizePx: number): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, sizePx, sizePx);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, sizePx - 8, sizePx - 8);
  ctx.fillStyle = "#000";
  ctx.font = `${Math.floor(sizePx / 10)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TWIN", sizePx / 2, sizePx / 2 - sizePx / 12);
  ctx.font = `${Math.floor(sizePx / 14)}px monospace`;
  ctx.fillText(text, sizePx / 2, sizePx / 2 + sizePx / 8);
  const dataUrl = canvas.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

interface Settings {
  stickerW: number; stickerH: number; // mm
  qrSize: number;                     // mm
  marginX: number; marginY: number;   // mm
  gap: number;                        // mm
  textPt: number;
  guides: boolean;
}

const DEFAULTS: Settings = {
  stickerW: 30, stickerH: 30,
  qrSize: 22,
  marginX: 10, marginY: 10,
  gap: 3,
  textPt: 6,
  guides: true,
};

type Grade = "COMMON" | "RARE" | "EPIC" | "LEGEND";
const GRADES: Grade[] = ["COMMON", "RARE", "EPIC", "LEGEND"];

function tsName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function downloadBlob(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SiliconFactory() {
  const { t } = useLang();
  const { data: ordersData, isLoading } = useOrders();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [busy, setBusy] = useState<null | string>(null);
  const [progress, setProgress] = useState(0);
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  const [previewQr, setPreviewQr] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [templates, setTemplates] = useState<Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>>({
    COMMON: null, RARE: null, EPIC: null, LEGEND: null,
  });
  const [previewEdit, setPreviewEdit] = useState(() => localStorage.getItem("silicon-preview-edit") === "1");
  const [previewHeight, setPreviewHeight] = useState<number | null>(() => {
    const v = localStorage.getItem("silicon-preview-height");
    return v ? Number(v) : null;
  });

  // Persist preview height/edit state
  useState(() => {});
  useMemo(() => {
    localStorage.setItem("silicon-preview-edit", previewEdit ? "1" : "0");
  }, [previewEdit]);
  useMemo(() => {
    if (previewHeight !== null) localStorage.setItem("silicon-preview-height", String(previewHeight));
    else localStorage.removeItem("silicon-preview-height");
  }, [previewHeight]);

  const onUploadTemplate = async (grade: Grade, file: File | null) => {
    if (!file) { setTemplates(prev => ({ ...prev, [grade]: null })); return; }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { dataUrl, aspect } = await renderPdfFirstPagePng(buf);
      setTemplates(prev => ({ ...prev, [grade]: { name: file.name, bytes: buf, preview: dataUrl, aspect } }));
    } catch (e: any) {
      toast({ title: "PDF 미리보기 실패", description: e.message, variant: "destructive" });
    }
  };

  const rows: Row[] = useMemo(() => {
    if (!ordersData) return [];
    const seen = new Map<string, number>();
    (ordersData as any[]).forEach(o => seen.set(o.external_order_id, (seen.get(o.external_order_id) || 0) + 1));
    return (ordersData as any[]).map(o => {
      const orderNo = o.external_order_id;
      const url = findSvgUrl(o);
      const dup = (seen.get(orderNo) || 0) > 1;
      const rawGrade = String(
        o.source_data?.items?.[0]?.grade ??
        o.source_data?.grade ??
        o.grade ??
        "COMMON"
      ).toUpperCase();
      const grade: Grade = (GRADES as string[]).includes(rawGrade) ? (rawGrade as Grade) : "COMMON";
      const status: Row["status"] = dup ? "duplicate" : url ? "ok" : "no-svg";
      return {
        orderNo,
        uniqueNo: `${orderNo}-1`,
        recipient: o.recipient_name,
        product: o.product_code,
        grade,
        svgUrl: url,
        status,
      };
    }).sort((a, b) => a.orderNo.localeCompare(b.orderNo));
  }, [ordersData]);

  const filtered = rows.filter(r => {
    if (errorsOnly && r.status === "ok") return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return r.orderNo.toLowerCase().includes(s) || r.recipient?.toLowerCase().includes(s) || r.product?.toLowerCase().includes(s);
  });

  const selectedRows = filtered.filter(r => selected.has(r.orderNo));
  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.orderNo));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach(r => next.delete(r.orderNo));
    else filtered.forEach(r => next.add(r.orderNo));
    setSelected(next);
  };
  const toggle = (no: string) => {
    const next = new Set(selected);
    next.has(no) ? next.delete(no) : next.add(no);
    setSelected(next);
  };

  const validate = (list: Row[]): string | null => {
    if (list.length === 0) return "선택된 항목이 없습니다.";
    const dup = list.find(r => r.status === "duplicate");
    if (dup) return `중복된 주문번호: ${dup.orderNo}`;
    return null;
  };

  const openPreview = async (r: Row) => {
    setPreviewRow(r);
    const qr = await QRCode.toDataURL(r.uniqueNo, { errorCorrectionLevel: "M", margin: 1, width: 240 });
    setPreviewQr(qr);
  };

  const generateSiliconePdf = async () => {
    const err = validate(selectedRows);
    if (err) { toast({ title: "오류", description: err, variant: "destructive" }); return; }
    const missingGrades = Array.from(new Set(selectedRows.map(r => r.grade))).filter(g => !templates[g]);
    if (missingGrades.length > 0) {
      toast({ title: "포맷 미업로드", description: `등급 PDF 포맷이 없습니다: ${missingGrades.join(", ")}`, variant: "destructive" });
      return;
    }
    setBusy("실리콘 마크 PDF 생성 중..."); setProgress(0);
    try {
      const out = await PDFDocument.create();
      const font = await out.embedFont(StandardFonts.Helvetica);

      // Cache loaded template docs and copied pages per grade
      const tmplCache: Partial<Record<Grade, PDFDocument>> = {};
      const getTmpl = async (g: Grade) => {
        if (!tmplCache[g]) tmplCache[g] = await PDFDocument.load(templates[g]!.bytes);
        return tmplCache[g]!;
      };

      for (let i = 0; i < selectedRows.length; i++) {
        const r = selectedRows[i];
        const tmpl = await getTmpl(r.grade);
        const [copied] = await out.copyPages(tmpl, [0]);
        const page = out.addPage(copied);
        const { width: pw, height: ph } = page.getSize();

        // Overlay twincode SVG (centered) + uniqueNo text (bottom)
        try {
          const pngBytes = r.svgUrl
            ? await svgUrlToPng(r.svgUrl, 600)
            : placeholderSvgPng(r.orderNo, 600);
          const png = await out.embedPng(pngBytes);
          const target = Math.min(pw, ph) * 0.35;
          const scale = target / Math.max(png.width, png.height);
          const w = png.width * scale, h = png.height * scale;
          page.drawImage(png, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        } catch (e) {
          console.error("SVG embed failed", r.orderNo, e);
        }
        const tw = font.widthOfTextAtSize(r.uniqueNo, settings.textPt);
        page.drawText(r.uniqueNo, {
          x: (pw - tw) / 2,
          y: settings.marginY * MM,
          size: settings.textPt,
          font,
          color: rgb(0, 0, 0),
        });
        setProgress(Math.round(((i + 1) / selectedRows.length) * 100));
      }
      const bytes = await out.save();
      const first = selectedRows[0].uniqueNo;
      const last = selectedRows[selectedRows.length - 1].uniqueNo;
      downloadBlob(bytes, `silicone-mark_${first}_${last}_${tsName()}.pdf`);
      toast({ title: "실리콘 마크 PDF 생성 완료", description: `${selectedRows.length}건` });
    } catch (e: any) {
      toast({ title: "PDF 생성 실패", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null); setProgress(0);
    }
  };

  const generateQrPdf = async () => {
    const err = validate(selectedRows);
    if (err) { toast({ title: "오류", description: err, variant: "destructive" }); return; }
    setBusy("QR 스티커 PDF 생성 중..."); setProgress(0);
    try {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const pageW = 210 * MM, pageH = 297 * MM;
      const cellW = settings.stickerW * MM, cellH = settings.stickerH * MM;
      const gridW = pageW - 2 * settings.marginX * MM;
      const gridH = pageH - 2 * settings.marginY * MM;
      const cols = Math.max(1, Math.floor((gridW + settings.gap * MM) / (cellW + settings.gap * MM)));
      const rowsPerPage = Math.max(1, Math.floor((gridH + settings.gap * MM) / (cellH + settings.gap * MM)));
      const perPage = cols * rowsPerPage;

      let page = pdf.addPage([pageW, pageH]);
      for (let i = 0; i < selectedRows.length; i++) {
        const r = selectedRows[i];
        const idx = i % perPage;
        if (i > 0 && idx === 0) page = pdf.addPage([pageW, pageH]);
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = settings.marginX * MM + col * (cellW + settings.gap * MM);
        const yTop = pageH - settings.marginY * MM - row * (cellH + settings.gap * MM);
        const yBot = yTop - cellH;

        if (settings.guides) {
          page.drawRectangle({ x, y: yBot, width: cellW, height: cellH, borderColor: rgb(0.7,0.7,0.7), borderWidth: 0.3 });
        }
        const dataUrl = await QRCode.toDataURL(r.uniqueNo, { errorCorrectionLevel: "M", margin: 0, width: 400 });
        const b = atob(dataUrl.split(",")[1]);
        const arr = new Uint8Array(b.length);
        for (let j = 0; j < b.length; j++) arr[j] = b.charCodeAt(j);
        const png = await pdf.embedPng(arr);
        const qrPt = settings.qrSize * MM;
        const qrX = x + (cellW - qrPt) / 2;
        const qrY = yBot + (cellH - qrPt) / 2 + settings.textPt / 2 + 1;
        page.drawImage(png, { x: qrX, y: qrY, width: qrPt, height: qrPt });
        const tw = font.widthOfTextAtSize(r.uniqueNo, settings.textPt);
        page.drawText(r.uniqueNo, {
          x: x + (cellW - tw) / 2,
          y: yBot + 2,
          size: settings.textPt,
          font,
          color: rgb(0, 0, 0),
        });
        setProgress(Math.round(((i + 1) / selectedRows.length) * 100));
      }
      const bytes = await pdf.save();
      const first = selectedRows[0].uniqueNo;
      const last = selectedRows[selectedRows.length - 1].uniqueNo;
      downloadBlob(bytes, `qr-sticker_${first}_${last}_${tsName()}.pdf`);
      toast({ title: "QR 스티커 PDF 생성 완료", description: `${selectedRows.length}건` });
    } catch (e: any) {
      toast({ title: "PDF 생성 실패", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null); setProgress(0);
    }
  };

  const errorCount = rows.filter(r => r.status !== "ok").length;

  return (
    <div>
      <PageHeader title={t("menu.outSilicon")} description="트윈코드 SVG 실리콘 마크 PDF + 주문번호 QR 스티커 A4 PDF 생성" />
      <div className="p-6 space-y-4">
        {/* Settings */}
        <Card>
          <CardHeader><CardTitle className="text-base">PDF 설정</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="mark">
              <TabsList>
                <TabsTrigger value="mark">실리콘 마크</TabsTrigger>
                <TabsTrigger value="qr">QR 스티커</TabsTrigger>
              </TabsList>
              <TabsContent value="mark" className="pt-3">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="text-xs text-muted-foreground">
                    마크 등급별 PDF 포맷을 업로드하세요. PDF 파일의 실사이즈 그대로 사용됩니다.
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {previewEdit && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setPreviewHeight(h => Math.max(120, (h ?? 400) - 40))}>-</Button>
                        <span className="text-xs w-16 text-center tabular-nums">{previewHeight ?? "auto"}{previewHeight ? "px" : ""}</span>
                        <Button size="sm" variant="outline" onClick={() => setPreviewHeight(h => Math.min(1200, (h ?? 400) + 40))}>+</Button>
                        <Button size="sm" variant="ghost" onClick={() => setPreviewHeight(null)}>초기화</Button>
                      </>
                    )}
                    <Button size="sm" variant={previewEdit ? "default" : "outline"} onClick={() => setPreviewEdit(v => !v)}>
                      {previewEdit ? "편집 완료" : "높이 편집"}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {GRADES.map(g => (
                    <div key={g} className={`border rounded-md p-3 space-y-2 ${previewEdit ? "ring-1 ring-primary/40" : ""}`}>
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">{g}</Label>
                        {templates[g] && (
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onUploadTemplate(g, null)}>
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      <div
                        className="w-full border rounded bg-muted/30 overflow-hidden flex items-center justify-center"
                        style={
                          previewHeight
                            ? { height: `${previewHeight}px` }
                            : { aspectRatio: templates[g]?.aspect ? String(templates[g]!.aspect) : "3 / 4" }
                        }
                      >
                        {templates[g]?.preview ? (
                          <img
                            src={templates[g]!.preview}
                            alt={`${g} preview`}
                            className="w-full h-full object-contain bg-white"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">미리보기 없음</span>
                        )}
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer text-xs px-3 py-2 border border-dashed rounded hover:bg-accent">
                        <Upload className="w-3 h-3" />
                        <span className="truncate">{templates[g]?.name || "PDF 업로드"}</span>
                        <input
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          onChange={e => onUploadTemplate(g, e.target.files?.[0] || null)}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="qr" className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">
                <NumField label="스티커 가로(mm)" v={settings.stickerW} set={v => setSettings({ ...settings, stickerW: v })} />
                <NumField label="스티커 세로(mm)" v={settings.stickerH} set={v => setSettings({ ...settings, stickerH: v })} />
                <NumField label="QR 크기(mm)" v={settings.qrSize} set={v => setSettings({ ...settings, qrSize: v })} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Toolbar */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className="text-base">주문 목록</CardTitle>
              <Input placeholder="주문번호 / 거래처 / 상품 검색" value={search} onChange={e => setSearch(e.target.value)} className="w-72" />
              <div className="flex items-center gap-2">
                <Switch checked={errorsOnly} onCheckedChange={setErrorsOnly} />
                <Label className="text-sm">오류만 보기 ({errorCount})</Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!!busy || selectedRows.length === 0} onClick={generateSiliconePdf}>
                {busy?.includes("실리콘") ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}
                실리콘 마크 PDF
              </Button>
              <Button size="sm" disabled={!!busy || selectedRows.length === 0} onClick={generateQrPdf}>
                {busy?.includes("QR") ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <QrCode className="w-4 h-4 mr-1" />}
                QR 스티커 PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {busy && (
              <div className="mb-3 text-xs text-muted-foreground">{busy} {progress}%</div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>주문번호</TableHead>
                  <TableHead>실리콘 고유번호</TableHead>
                  <TableHead>거래처(트윈커)</TableHead>
                  <TableHead>상품코드</TableHead>
                  <TableHead>등급</TableHead>
                  <TableHead>SVG</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">미리보기</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">로딩 중...</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">주문 데이터가 없습니다</TableCell></TableRow>
                )}
                {filtered.map((r, i) => (
                  <TableRow key={r.orderNo} className={r.status !== "ok" ? "bg-destructive/5" : ""}>
                    <TableCell><Checkbox checked={selected.has(r.orderNo)} onCheckedChange={() => toggle(r.orderNo)} /></TableCell>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono">{r.orderNo}</TableCell>
                    <TableCell className="font-mono">{r.uniqueNo}</TableCell>
                    <TableCell>{r.recipient}</TableCell>
                    <TableCell>{r.product}</TableCell>
                    <TableCell><Badge variant="outline">{r.grade}</Badge></TableCell>
                    <TableCell>{r.svgUrl ? <Badge variant="outline">OK</Badge> : <Badge variant="secondary">없음</Badge>}</TableCell>
                    <TableCell>
                      {r.status === "ok" && <Badge variant="outline">정상</Badge>}
                      {r.status === "no-svg" && <Badge variant="secondary"><AlertTriangle className="w-3 h-3 mr-1" />SVG 없음</Badge>}
                      {r.status === "duplicate" && <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />중복</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openPreview(r)}><Eye className="w-4 h-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!previewRow} onOpenChange={o => { if (!o) { setPreviewRow(null); setPreviewQr(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>미리보기 · {previewRow?.uniqueNo}</DialogTitle></DialogHeader>
          {previewRow && (
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded p-4 flex flex-col items-center gap-2">
                <div className="text-xs text-muted-foreground">실리콘 마크</div>
                {previewRow.svgUrl ? (
                  <img src={previewRow.svgUrl} alt="svg" className="w-32 h-32 object-contain" />
                ) : (
                  <div className="w-32 h-32 border border-dashed flex items-center justify-center text-xs">SVG 없음</div>
                )}
                <div className="font-mono text-xs">{previewRow.uniqueNo}</div>
              </div>
              <div className="border rounded p-4 flex flex-col items-center gap-2">
                <div className="text-xs text-muted-foreground">QR 스티커</div>
                {previewQr && <img src={previewQr} alt="qr" className="w-32 h-32" />}
                <div className="font-mono text-xs">{previewRow.uniqueNo}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NumField({ label, v, set }: { label: string; v: number; set: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={v} onChange={e => set(Number(e.target.value) || 0)} />
    </div>
  );
}
