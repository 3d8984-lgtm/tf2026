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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Download, Eye, FileText, AlertTriangle, Loader2, QrCode, Upload, X, ChevronLeft } from "lucide-react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

interface Row {
  orderNo: string;
  uniqueNo: string; // orderNo + "-1"
  recipient: string;
  product: string;
  grade: Grade;
  svgUrl: string | null;
  svgCount: number;
  quantity: number;
  receivedAt: string; // YYYY-MM-DD
  dueDate: string;    // YYYY-MM-DD
  status: "ok" | "no-svg" | "duplicate" | "no-template";
}

function fmtDate(v?: string | null): string {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v).slice(0, 10); }
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

const PREVIEW_SETTINGS_KEY = "outsource-silicon-preview";

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
  const { user } = useAuth();
  const { data: ordersData, isLoading } = useOrders();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [busy, setBusy] = useState<null | string>(null);
  const [progress, setProgress] = useState(0);
  const [previewRow, setPreviewRow] = useState<{ uniqueNo: string; svgUrl: string | null } | null>(null);
  const [previewQr, setPreviewQr] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [detailOrderNo, setDetailOrderNo] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>>({
    COMMON: null, RARE: null, EPIC: null, LEGEND: null,
  });
  const [previewEdit, setPreviewEdit] = useState(false);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const [previewSettingsLoaded, setPreviewSettingsLoaded] = useState(false);
  const [proof, setProof] = useState({
    twinSize: 12,
    twinCols: 5,
    twinRows: 7,
    twinGap: 3,
    qrSize: 25,
    qrGap: 5,
  });
  const [proofPage, setProofPage] = useState(0);
  const [proofQrPage, setProofQrPage] = useState(0);
  const [proofQrMap, setProofQrMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const loadPreviewSettings = async () => {
      if (!user?.id) {
        setPreviewSettingsLoaded(true);
        return;
      }

      const { data, error } = await supabase
        .from("user_ui_settings")
        .select("setting_value")
        .eq("user_id", user.id)
        .eq("setting_key", PREVIEW_SETTINGS_KEY)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error("Failed to load preview settings:", error);
        setPreviewSettingsLoaded(true);
        return;
      }

      const value = data?.setting_value as { previewEdit?: unknown; previewHeight?: unknown } | undefined;
      setPreviewEdit(value?.previewEdit === true);
      setPreviewHeight(typeof value?.previewHeight === "number" ? value.previewHeight : null);
      setPreviewSettingsLoaded(true);
    };

    void loadPreviewSettings();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !previewSettingsLoaded) return;

    const timeout = window.setTimeout(async () => {
      const { error } = await supabase
        .from("user_ui_settings")
        .upsert({
          user_id: user.id,
          setting_key: PREVIEW_SETTINGS_KEY,
          setting_value: { previewEdit, previewHeight },
        }, { onConflict: "user_id,setting_key" });

      if (error) {
        console.error("Failed to save preview settings:", error);
        toast({ title: "미리보기 높이 저장 실패", description: error.message, variant: "destructive" });
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [previewEdit, previewHeight, previewSettingsLoaded, user?.id]);

  // Load persisted PDF templates from storage on mount
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data: list } = await supabase.storage
        .from("silicon-templates")
        .list(user.id);
      const nameByGrade = new Map<Grade, string>();
      (list || []).forEach(f => {
        const m = f.name.match(/^([A-Z]+)__(.+)\.pdf$/);
        if (m && (GRADES as string[]).includes(m[1])) nameByGrade.set(m[1] as Grade, f.name);
      });
      for (const g of GRADES) {
        const stored = nameByGrade.get(g);
        if (!stored) continue;
        const path = `${user.id}/${stored}`;
        const { data: file, error } = await supabase.storage
          .from("silicon-templates")
          .download(path);
        if (cancelled || error || !file) continue;
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          const { dataUrl, aspect } = await renderPdfFirstPagePng(buf);
          if (cancelled) return;
          const origName = stored.replace(/^[A-Z]+__/, "");
          setTemplates(prev => ({
            ...prev,
            [g]: { name: origName, bytes: buf, preview: dataUrl, aspect },
          }));
        } catch (e) {
          console.error("Failed to load template", g, e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const onUploadTemplate = async (grade: Grade, file: File | null) => {
    if (!user?.id) {
      toast({ title: "로그인 필요", variant: "destructive" });
      return;
    }
    // Always clear any existing files for this grade
    const { data: existing } = await supabase.storage.from("silicon-templates").list(user.id);
    const toRemove = (existing || [])
      .filter(f => f.name.startsWith(`${grade}__`))
      .map(f => `${user.id}/${f.name}`);
    if (toRemove.length) await supabase.storage.from("silicon-templates").remove(toRemove);

    if (!file) { setTemplates(prev => ({ ...prev, [grade]: null })); return; }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { dataUrl, aspect } = await renderPdfFirstPagePng(buf);
      setTemplates(prev => ({ ...prev, [grade]: { name: file.name, bytes: buf, preview: dataUrl, aspect } }));
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${user.id}/${grade}__${safeName}`;
      const { error } = await supabase.storage
        .from("silicon-templates")
        .upload(path, new Blob([buf as BlobPart], { type: "application/pdf" }), {
          upsert: true,
          contentType: "application/pdf",
        });
      if (error) toast({ title: "PDF 저장 실패", description: error.message, variant: "destructive" });
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
      const items: any[] = Array.isArray(o.source_data?.items) ? o.source_data.items : [];
      const svgCount = items.filter(it =>
        typeof (it?.twincode_svg_url ?? it?.svg_url ?? it?.twin_code_svg_url) === "string"
        && String(it.twincode_svg_url ?? it.svg_url ?? it.twin_code_svg_url).trim().length > 0
      ).length || (url ? 1 : 0);
      return {
        orderNo,
        uniqueNo: `${orderNo}-1`,
        recipient: o.recipient_name,
        product: o.product_code,
        grade,
        svgUrl: url,
        svgCount,
        quantity: o.quantity ?? 0,
        receivedAt: fmtDate(o.created_at),
        dueDate: fmtDate(o.project_completed_at),
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

  const openPreview = async (uniqueNo: string, svgUrl: string | null) => {
    setPreviewRow({ uniqueNo, svgUrl });
    const qr = await QRCode.toDataURL(uniqueNo, { errorCorrectionLevel: "M", margin: 1, width: 240 });
    setPreviewQr(qr);
  };

  const detailItems = useMemo(() => {
    if (!detailOrderNo || !ordersData) return [];
    const order = (ordersData as any[]).find(o => o.external_order_id === detailOrderNo);
    if (!order) return [];
    const items: any[] = Array.isArray(order.source_data?.items) ? order.source_data.items : [];
    const qty = order.quantity || items.length || 1;
    const orderSvg = findSvgUrl(order);
    const count = Math.max(items.length, qty);
    return Array.from({ length: count }, (_, idx) => {
      const it = items[idx] || {};
      const svgUrl =
        (typeof it.twincode_svg_url === "string" && it.twincode_svg_url) ||
        (typeof it.svg_url === "string" && it.svg_url) ||
        (typeof it.twin_code_svg_url === "string" && it.twin_code_svg_url) ||
        orderSvg || null;
      const rawGrade = String(it.grade ?? order.source_data?.grade ?? order.grade ?? "COMMON").toUpperCase();
      const grade: Grade = (GRADES as string[]).includes(rawGrade) ? (rawGrade as Grade) : "COMMON";
      return {
        seq: idx + 1,
        orderNo: detailOrderNo,
        uniqueNo: `${detailOrderNo}-${idx + 1}`,
        svgUrl,
        grade,
      };
    });
  }, [detailOrderNo, ordersData]);

  // Generate QR dataURLs for all detail items (for proof preview)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const it of detailItems) {
        try {
          next[it.uniqueNo] = await QRCode.toDataURL(it.uniqueNo, { errorCorrectionLevel: "M", margin: 0, width: 200 });
        } catch {}
      }
      if (!cancelled) setProofQrMap(next);
    })();
    return () => { cancelled = true; };
  }, [detailItems]);

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

  if (detailOrderNo) {
    return (
      <div>
        <PageHeader title={`${t("menu.outSilicon")} · ${detailOrderNo}`} description="주문 상세 목록" />
        <div className="p-6 space-y-4">
          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => setDetailOrderNo(null)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> 목록으로
              </Button>
              <div className="text-sm text-muted-foreground">
                작업번호 <span className="font-mono text-foreground">{detailOrderNo}</span> · {detailItems.length}건
              </div>
            </CardContent>
          </Card>

          <ProofBox
            items={detailItems}
            templates={templates}
            proof={proof}
            setProof={setProof}
            qrMap={proofQrMap}
            page={proofPage}
            setPage={setProofPage}
            qrPage={proofQrPage}
            setQrPage={setProofQrPage}
          />

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">순번</TableHead>
                    <TableHead>주문번호</TableHead>
                    <TableHead>마크 고유번호</TableHead>
                    <TableHead>카드등급</TableHead>
                    <TableHead>트윈코드</TableHead>
                    <TableHead>QR코드</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailItems.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">—</TableCell></TableRow>
                  )}
                  {detailItems.map(it => (
                    <TableRow
                      key={it.uniqueNo}
                      className="cursor-pointer"
                      onClick={() => openPreview(it.uniqueNo, it.svgUrl)}
                    >
                      <TableCell className="tabular-nums">{it.seq}</TableCell>
                      <TableCell className="font-mono">{it.orderNo}</TableCell>
                      <TableCell className="font-mono">{it.uniqueNo}</TableCell>
                      <TableCell><Badge variant="outline">{it.grade}</Badge></TableCell>
                      <TableCell>
                        {it.svgUrl ? (
                          <img src={it.svgUrl} alt="twincode" className="w-10 h-10 object-contain border rounded bg-white" />
                        ) : (
                          <span className="text-xs text-muted-foreground">없음</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <QrThumb value={it.uniqueNo} />
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
                  <div className="text-xs text-muted-foreground">트윈코드</div>
                  {previewRow.svgUrl ? (
                    <img src={previewRow.svgUrl} alt="svg" className="w-40 h-40 object-contain bg-white" />
                  ) : (
                    <div className="w-40 h-40 border border-dashed flex items-center justify-center text-xs">SVG 없음</div>
                  )}
                  <div className="font-mono text-xs">{previewRow.uniqueNo}</div>
                </div>
                <div className="border rounded p-4 flex flex-col items-center gap-2">
                  <div className="text-xs text-muted-foreground">QR코드</div>
                  {previewQr && <img src={previewQr} alt="qr" className="w-40 h-40" />}
                  <div className="font-mono text-xs">{previewRow.uniqueNo}</div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }


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
            <div className="flex gap-2" />
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
                  <TableHead>작업번호</TableHead>
                  <TableHead>주문접수일</TableHead>
                  <TableHead>납기일</TableHead>
                  <TableHead>트윈커</TableHead>
                  <TableHead className="text-right">작업수량</TableHead>
                  <TableHead className="text-right">트윈코드(SVG) 수량</TableHead>
                  <TableHead className="text-right">상세보기</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">로딩 중...</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">주문 데이터가 없습니다</TableCell></TableRow>
                )}
                {filtered.map((r, i) => (
                  <TableRow key={r.orderNo} className={r.status !== "ok" ? "bg-destructive/5" : ""}>
                    <TableCell><Checkbox checked={selected.has(r.orderNo)} onCheckedChange={() => toggle(r.orderNo)} /></TableCell>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono">{r.orderNo}</TableCell>
                    <TableCell>{r.receivedAt}</TableCell>
                    <TableCell>{r.dueDate || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>{r.recipient}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.svgCount > 0
                        ? <Badge variant="outline">{r.svgCount}</Badge>
                        : <Badge variant="secondary"><AlertTriangle className="w-3 h-3 mr-1" />0</Badge>}
                    </TableCell>
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
    ? <img src={src} alt="qr" className="w-10 h-10 border rounded bg-white" />
    : <div className="w-10 h-10 border rounded bg-muted" />;
}

function NumField({ label, v, set }: { label: string; v: number; set: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={v} onChange={e => set(Number(e.target.value) || 0)} />
    </div>
  );
}

interface ProofItem { seq: number; orderNo: string; uniqueNo: string; svgUrl: string | null; grade: Grade; }
interface ProofSettings { twinSize: number; twinCols: number; twinRows: number; twinGap: number; qrSize: number; qrGap: number; }

function ProofBox({
  items, templates, proof, setProof, qrMap, page, setPage, qrPage, setQrPage,
}: {
  items: ProofItem[];
  templates: Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>;
  proof: ProofSettings;
  setProof: React.Dispatch<React.SetStateAction<ProofSettings>>;
  qrMap: Record<string, string>;
  page: number; setPage: (n: number) => void;
  qrPage: number; setQrPage: (n: number) => void;
}) {
  const PAPER_W_PX = 640;
  const A4_W = 210, A4_H = 297;
  const mmPx = PAPER_W_PX / A4_W;
  const paperHpx = A4_H * mmPx;

  // ===== 트윈코드 시안 =====
  const tCols = Math.max(1, proof.twinCols);
  const tRows = Math.max(1, proof.twinRows);
  const tGap = proof.twinGap;
  const cellW = (A4_W - (tCols - 1) * tGap) / tCols;
  const cellH = (A4_H - (tRows - 1) * tGap) / tRows;
  const perPageT = tCols * tRows;
  const totalPagesT = Math.max(1, Math.ceil(items.length / perPageT));
  const pageT = Math.min(page, totalPagesT - 1);
  const pageItemsT = items.slice(pageT * perPageT, pageT * perPageT + perPageT);

  // ===== QR 시안 =====
  const qMargin = 10;
  const qCols = Math.max(1, Math.floor((A4_W - 2 * qMargin + proof.qrGap) / (proof.qrSize + proof.qrGap)));
  const qRows = Math.max(1, Math.floor((A4_H - 2 * qMargin + proof.qrGap) / (proof.qrSize + proof.qrGap)));
  const perPageQ = qCols * qRows;
  const totalPagesQ = Math.max(1, Math.ceil(items.length / perPageQ));
  const pageQ = Math.min(qrPage, totalPagesQ - 1);
  const pageItemsQ = items.slice(pageQ * perPageQ, pageQ * perPageQ + perPageQ);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">시안 박스 · 공장 발주 파일 확인</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="twin">
          <TabsList>
            <TabsTrigger value="twin">트윈코드 시안</TabsTrigger>
            <TabsTrigger value="qr">큐알코드 시안</TabsTrigger>
          </TabsList>

          {/* ============== 트윈코드 시안 ============== */}
          <TabsContent value="twin" className="pt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="트윈코드 크기(mm)" v={proof.twinSize} set={v => setProof(p => ({ ...p, twinSize: v }))} />
              <NumField label="가로 수량" v={proof.twinCols} set={v => setProof(p => ({ ...p, twinCols: v }))} />
              <NumField label="세로 수량" v={proof.twinRows} set={v => setProof(p => ({ ...p, twinRows: v }))} />
              <NumField label="마크 이격(mm)" v={proof.twinGap} set={v => setProof(p => ({ ...p, twinGap: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                페이지당 {perPageT}개 · 총 {items.length}개 · {totalPagesT}페이지
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={pageT <= 0} onClick={() => setPage(pageT - 1)}>이전</Button>
                <span className="text-xs tabular-nums w-16 text-center">{pageT + 1} / {totalPagesT}</span>
                <Button size="sm" variant="outline" disabled={pageT >= totalPagesT - 1} onClick={() => setPage(pageT + 1)}>다음</Button>
              </div>
            </div>
            <div className="flex justify-center">
              <div
                className="relative bg-white shadow border"
                style={{ width: PAPER_W_PX, height: paperHpx }}
              >
                {pageItemsT.map((it, idx) => {
                  const col = idx % tCols;
                  const row = Math.floor(idx / tCols);
                  const x = col * (cellW + tGap) * mmPx;
                  const y = row * (cellH + tGap) * mmPx;
                  const w = cellW * mmPx;
                  const h = cellH * mmPx;
                  const tmpl = templates[it.grade];
                  const twinPx = proof.twinSize * mmPx;
                  return (
                    <div
                      key={it.uniqueNo}
                      className="absolute flex items-center justify-center"
                      style={{ left: x, top: y, width: w, height: h }}
                    >
                      {tmpl?.preview ? (
                        <img src={tmpl.preview} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                      ) : (
                        <div className="absolute inset-0 border border-dashed border-muted-foreground/40 flex items-center justify-center text-[9px] text-muted-foreground">
                          {it.grade} 포맷 없음
                        </div>
                      )}
                      {it.svgUrl ? (
                        <img
                          src={it.svgUrl}
                          alt=""
                          className="relative object-contain"
                          style={{ width: twinPx, height: twinPx }}
                        />
                      ) : (
                        <div
                          className="relative border border-dashed border-destructive flex items-center justify-center text-[8px] text-destructive"
                          style={{ width: twinPx, height: twinPx }}
                        >no svg</div>
                      )}
                      <div
                        className="absolute left-0 right-0 text-center font-mono text-foreground"
                        style={{ bottom: 2 * mmPx, fontSize: Math.max(6, 2.2 * mmPx) }}
                      >
                        {it.uniqueNo}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* ============== 큐알코드 시안 ============== */}
          <TabsContent value="qr" className="pt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="QR 크기(mm)" v={proof.qrSize} set={v => setProof(p => ({ ...p, qrSize: v }))} />
              <NumField label="QR 간격(mm)" v={proof.qrGap} set={v => setProof(p => ({ ...p, qrGap: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {qCols} × {qRows} · 페이지당 {perPageQ}개 · 총 {items.length}개 · {totalPagesQ}페이지
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={pageQ <= 0} onClick={() => setQrPage(pageQ - 1)}>이전</Button>
                <span className="text-xs tabular-nums w-16 text-center">{pageQ + 1} / {totalPagesQ}</span>
                <Button size="sm" variant="outline" disabled={pageQ >= totalPagesQ - 1} onClick={() => setQrPage(pageQ + 1)}>다음</Button>
              </div>
            </div>
            <div className="flex justify-center">
              <div
                className="relative bg-white shadow border"
                style={{ width: PAPER_W_PX, height: paperHpx }}
              >
                {pageItemsQ.map((it, idx) => {
                  const col = idx % qCols;
                  const row = Math.floor(idx / qCols);
                  const x = (qMargin + col * (proof.qrSize + proof.qrGap)) * mmPx;
                  const y = (qMargin + row * (proof.qrSize + proof.qrGap)) * mmPx;
                  const s = proof.qrSize * mmPx;
                  const labelH = Math.max(8, 3 * mmPx);
                  const qrH = s - labelH - 2;
                  return (
                    <div
                      key={it.uniqueNo}
                      className="absolute border border-dashed border-foreground/60 flex flex-col items-center justify-center"
                      style={{ left: x, top: y, width: s, height: s }}
                      title={`칼선: ${it.uniqueNo}`}
                    >
                      {qrMap[it.uniqueNo] ? (
                        <img src={qrMap[it.uniqueNo]} alt="qr" style={{ width: qrH, height: qrH }} />
                      ) : (
                        <div style={{ width: qrH, height: qrH }} className="bg-muted" />
                      )}
                      <div
                        className="font-mono text-foreground leading-none"
                        style={{ fontSize: Math.max(6, 2 * mmPx), marginTop: 1 }}
                      >
                        {it.uniqueNo}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground text-center">
              ※ 점선 사각형은 각 QR 라벨의 칼선이며 마크 고유번호를 포함합니다.
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
