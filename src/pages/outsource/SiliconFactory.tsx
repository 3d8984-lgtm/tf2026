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
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { Download, Eye, FileText, AlertTriangle, Loader2, QrCode, Upload, X, ChevronLeft, CheckCircle2, Send, Settings, Package } from "lucide-react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import html2canvas from "html2canvas";

// Convert SVG text → single-page PDF bytes (vector). Page size in pt.
async function svgToVectorPdfBytes(svgText: string, widthPt: number, heightPt: number): Promise<Uint8Array> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.documentElement as unknown as SVGSVGElement;
  // svg2pdf requires the element to be in the DOM for measurements
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.appendChild(svgEl);
  document.body.appendChild(host);
  try {
    const pdf = new jsPDF({ unit: "pt", format: [widthPt, heightPt] });
    await svg2pdf(svgEl, pdf, { x: 0, y: 0, width: widthPt, height: heightPt });
    const ab = pdf.output("arraybuffer");
    return new Uint8Array(ab);
  } finally {
    document.body.removeChild(host);
  }
}
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
type WebhookLogInsert = Database["public"]["Tables"]["webhook_logs"]["Insert"];

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
  const [proof, setProof] = useState(() => {
    const defaults = {
      twinSize: 12, twinCols: 5, twinRows: 7, twinGap: 3, twinMargin: 3,
      twinOffsetX: 0, twinOffsetY: 0, twinTextSize: 2.5, twinTextGap: 2,
      markW: 63, // 마크 가로(mm). 세로는 원본 비율(63:60.811)로 자동 계산
      qrSize: 25, qrCutSize: 25, qrGap: 5, qrTextSize: 2, qrTextGap: 1,
    };
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("silicon.proofSettings.v1") : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.qrCutSize !== "number") parsed.qrCutSize = parsed.qrSize ?? defaults.qrCutSize;
        if (typeof parsed.markW !== "number") parsed.markW = defaults.markW;
        return { ...defaults, ...parsed };
      }
    } catch {}
    return defaults;
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
        if (!m || !(GRADES as string[]).includes(m[1])) return;
        const grade = m[1] as Grade;
        const current = nameByGrade.get(grade);
        if (!current || new Date(f.updated_at || f.created_at || 0).getTime() > new Date((list || []).find(item => item.name === current)?.updated_at || (list || []).find(item => item.name === current)?.created_at || 0).getTime()) {
          nameByGrade.set(grade, f.name);
        }
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
          const origName = stored.replace(/^[A-Z]+__(?:\d+__[-\w]+__)?/, "");
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

  const logStorageError = async (
    action: "upload" | "delete" | "list",
    grade: Grade,
    path: string,
    error: any,
    extra: Record<string, any> = {},
  ) => {
    let responseBody: Record<string, unknown> | null = null;
    if (error?.context instanceof Response) {
      try {
        responseBody = await error.context.clone().json();
      } catch {
        try { responseBody = { error: await error.context.clone().text() }; } catch (parseTextError) { console.error("[SiliconFactory] failed to parse error response", parseTextError); }
      }
    }
    const status = error?.statusCode ?? error?.status ?? error?.originalError?.status ?? error?.context?.status ?? responseBody?.statusCode ?? null;
    const message = responseBody?.error ?? responseBody?.message ?? error?.error ?? error?.message ?? String(error);
    const code = responseBody?.code ?? error?.error ?? error?.name ?? null;
    const detail = [
      message,
      status ? `HTTP ${status}` : null,
      code,
    ].filter(Boolean).join(" · ");
    console.error(`[SiliconFactory] ${action} failed`, { grade, path, status, code, message, ...extra });
    try {
      const logRow: WebhookLogInsert = {
        source: "silicon_factory",
        event_type: `storage_${action}_failed`,
        status: "error",
        error_message: detail,
        payload: {
          grade,
          path,
          http_status: status,
          supabase_code: code,
          supabase_message: message,
          response_body: responseBody as Json,
          user_id: user?.id ?? null,
          ...extra,
        },
      };
      await supabase.from("webhook_logs").insert(logRow);
    } catch (logErr) {
      console.error("[SiliconFactory] failed to write admin log", logErr);
    }
    return detail;
  };

  const runTemplateStorageAction = async (form: FormData) => {
    const { data, error } = await supabase.functions.invoke("silicon-template-storage", { body: form });
    if (error) throw error;
    if (!data?.ok) throw data;
    return data as { ok: true; path?: string; removed?: string[] };
  };

  const onUploadTemplate = async (grade: Grade, file: File | null) => {
    if (!user?.id) {
      toast({ title: "로그인 필요", variant: "destructive" });
      return;
    }

    if (!file) {
      const form = new FormData();
      form.append("action", "delete");
      form.append("grade", grade);
      try {
        await runTemplateStorageAction(form);
        setTemplates(prev => ({ ...prev, [grade]: null }));
        toast({ title: "PDF 삭제 완료", description: `${grade} 등급` });
      } catch (e: any) {
        const detail = await logStorageError("delete", grade, `${user.id}/${grade}__*.pdf`, e);
        toast({ title: "PDF 삭제 실패", description: detail, variant: "destructive" });
      }
      return;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { dataUrl, aspect } = await renderPdfFirstPagePng(buf);
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const path = `${user.id}/${grade}__${safeName}`;
      const sizeMb = (buf.byteLength / (1024 * 1024)).toFixed(2);
      const form = new FormData();
      form.append("action", "upload");
      form.append("grade", grade);
      form.append("file", new Blob([buf as BlobPart], { type: "application/pdf" }), file.name);
      await runTemplateStorageAction(form);
      setTemplates(prev => ({ ...prev, [grade]: { name: file.name, bytes: buf, preview: dataUrl, aspect } }));
      toast({ title: "PDF 저장 완료", description: `${file.name} (${sizeMb}MB)` });
    } catch (e: any) {
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const path = `${user.id}/${grade}__${safeName}`;
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      const detail = await logStorageError("upload", grade, path, e, { size_mb: sizeMb, file_name: file.name });
      toast({ title: "PDF 저장 실패", description: `${detail} · 파일 ${sizeMb}MB`, variant: "destructive" });
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

  const detailOrder = useMemo(() => {
    if (!detailOrderNo || !ordersData) return null;
    return (ordersData as any[]).find(o => o.external_order_id === detailOrderNo) || null;
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

        // Overlay twincode as VECTOR (SVG → PDF page → embed). Falls back to PNG.
        try {
          const target = Math.min(pw, ph) * 0.35;
          if (r.svgUrl) {
            const res = await fetch(r.svgUrl);
            if (!res.ok) throw new Error("svg fetch failed");
            const svgText = await res.text();
            const vecBytes = await svgToVectorPdfBytes(svgText, target, target);
            const [embedded] = await out.embedPdf(vecBytes);
            page.drawPage(embedded, {
              x: (pw - target) / 2,
              y: (ph - target) / 2,
              width: target,
              height: target,
            });
          } else {
            const pngBytes = placeholderSvgPng(r.orderNo, 600);
            const png = await out.embedPng(pngBytes);
            const scale = target / Math.max(png.width, png.height);
            const w = png.width * scale, h = png.height * scale;
            page.drawImage(png, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
          }
        } catch (e) {
          console.error("twincode embed failed", r.orderNo, e);
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

          <SiliconOrderProgressBox
            order={detailOrder}
            items={detailItems}
            templates={templates}
            proof={proof}
            setProof={setProof}
            proofQrMap={proofQrMap}
            proofPage={proofPage}
            setProofPage={setProofPage}
            proofQrPage={proofQrPage}
            setProofQrPage={setProofQrPage}
          />



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
            order={detailOrder}
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
                      {templates[g] ? (
                        <div className="flex items-center gap-2">
                          <label className="flex-1 flex items-center justify-center gap-1 cursor-pointer text-xs px-3 py-2 border rounded hover:bg-accent">
                            <Upload className="w-3 h-3" />
                            <span>변경</span>
                            <input
                              type="file"
                              accept="application/pdf"
                              className="hidden"
                              onChange={e => onUploadTemplate(g, e.target.files?.[0] || null)}
                            />
                          </label>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs px-3 py-2 h-auto"
                            onClick={() => onUploadTemplate(g, null)}
                          >
                            삭제
                          </Button>
                        </div>
                      ) : (
                        <label className="flex items-center gap-2 cursor-pointer text-xs px-3 py-2 border border-dashed rounded hover:bg-accent">
                          <Upload className="w-3 h-3" />
                          <span className="truncate">PDF 업로드</span>
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={e => onUploadTemplate(g, e.target.files?.[0] || null)}
                          />
                        </label>
                      )}
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

function NumField({ label, v, set, step }: { label: string; v: number; set: (v: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step ?? 1} value={v} onChange={e => set(Number(e.target.value) || 0)} />
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

const PROOF_LS_KEY = "silicon.proofSettings.v1";
const GRADE_COLOR_LS_KEY = "silicon.gradeColorNames.v1";
const GRADE_COLOR_STYLE_LS_KEY = "silicon.gradeColorStyle.v1";

type GradeColorNames = Record<Grade, string>;
const DEFAULT_GRADE_COLOR_NAMES: GradeColorNames = { COMMON: "", RARE: "", EPIC: "", LEGEND: "" };

interface GradeColorStyle { fontSize: number; fontWeight: number; }
const DEFAULT_GRADE_COLOR_STYLE: GradeColorStyle = { fontSize: 14, fontWeight: 700 };

interface WorkOrderData {
  company: string; orderNo: string; orderDate: string; deliveryDate: string;
  common: number; rare: number; epic: number; legend: number; total: number;
  recipient: string; phone: string; address: string; notes: string;
}

function buildSiliconWorkOrderHtml(
  wo: WorkOrderData,
  templates: Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>,
  colorNames: GradeColorNames = DEFAULT_GRADE_COLOR_NAMES,
  colorStyle: GradeColorStyle = DEFAULT_GRADE_COLOR_STYLE,
  opts?: { autoPrint?: boolean },
): string {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const styleAttr = `style="font-size:${colorStyle.fontSize}pt;font-weight:${colorStyle.fontWeight};"`;
  const gradeLabel = (g: Grade) => colorNames[g]
    ? `${g} · <span class="g-color" ${styleAttr}>${esc(colorNames[g])}</span>`
    : g;
  const gradeRow = (g: Grade) => {
    const t = templates[g];
    const img = t?.preview
      ? `<img src="${t.preview}" alt="${g}" />`
      : `<div class="ph">未上传</div>`;
    return `<div class="g-cell"><div class="g-name">${gradeLabel(g)}</div><div class="g-img">${img}</div></div>`;
  };
  const printScript = opts?.autoPrint ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>` : "";
  const printBtn = opts?.autoPrint ? `<div class="no-print"><button onclick="window.print()">打印 / 保存PDF</button></div>` : "";
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
  .grades { display:grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; }
  .g-cell { border:1px solid #333; padding: 3mm; text-align:center; }
  .g-name { font-weight:700; font-size: 10pt; margin-bottom: 2mm; letter-spacing: 1px; }
  .g-img { height: 32mm; display:flex; align-items:center; justify-content:center; background:#fafafa; }
  .g-img img { max-width:100%; max-height:100%; object-fit: contain; }
  .ph { color:#999; font-size: 9pt; }
  .sig { margin-top: 10mm; display:flex; justify-content:flex-end; gap: 10mm; font-size: 10pt; }
  .sig div { border-top:1px solid #333; padding-top:2mm; min-width: 40mm; text-align:center; }
  @media print { .no-print { display:none; } body { padding: 0; } }
  .no-print { position:fixed; top:8px; right:8px; }
  .no-print button { padding: 8px 14px; font-size: 13px; cursor:pointer; }
</style></head>
<body>
  ${printBtn}
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
    <tr><th>${gradeLabel("COMMON")}</th><th>${gradeLabel("RARE")}</th><th>${gradeLabel("EPIC")}</th><th>${gradeLabel("LEGEND")}</th><th>总数量</th></tr>
    <tr><td>${esc(wo.common)}</td><td>${esc(wo.rare)}</td><td>${esc(wo.epic)}</td><td>${esc(wo.legend)}</td><td><strong>${esc(wo.total)}</strong></td></tr>
  </table>
  <h2>订单特殊事项</h2>
  <table><tr><td class="notes">${esc(wo.notes) || "&nbsp;"}</td></tr></table>
  <h2>各等级硅胶标识(示例)</h2>
  <div class="grades">
    ${(["COMMON","RARE","EPIC","LEGEND"] as Grade[]).map(gradeRow).join("")}
  </div>
  <div class="sig"><div>负责人</div><div>审批</div></div>
  ${printScript}
</body></html>`;
}

function printWorkOrder(
  wo: WorkOrderData,
  templates: Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>,
  colorNames: GradeColorNames = DEFAULT_GRADE_COLOR_NAMES,
  colorStyle: GradeColorStyle = DEFAULT_GRADE_COLOR_STYLE,
) {
  const html = buildSiliconWorkOrderHtml(wo, templates, colorNames, colorStyle, { autoPrint: true });
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", description: "팝업을 허용해주세요", variant: "destructive" }); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// ===== Silicon factory 발주 진행 helpers =====
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
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(dataUrl, "JPEG", (pageW - imgW) / 2, 0, imgW, imgH);
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    document.body.removeChild(iframe);
  }
}

function buildSiliconExcelBlob(items: Array<{ seq: number; uniqueNo: string; grade: Grade }>): Blob {
  const rows = items.map(it => ({
    "序号": it.seq,
    "标识唯一编号": it.uniqueNo,
    "等级": it.grade,
    "公司名称": "TWINMETA",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 10 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Silicon");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const SILICON_WECHAT_WEBHOOK_LS_KEY = "wechat.webhook.silicon";
const SILICON_WECHAT_HOOKS_SHARED_KEY = "outsource.wechatWebhooks.v1";

function readSiliconWebhook(): string {
  try {
    const shared = localStorage.getItem(SILICON_WECHAT_HOOKS_SHARED_KEY);
    if (shared) {
      const obj = JSON.parse(shared);
      if (obj?.silicon) return String(obj.silicon).trim();
    }
  } catch {}
  try { return (localStorage.getItem(SILICON_WECHAT_WEBHOOK_LS_KEY) || "").trim(); } catch { return ""; }
}

function writeSiliconWebhook(url: string) {
  const v = url.trim();
  try { localStorage.setItem(SILICON_WECHAT_WEBHOOK_LS_KEY, v); } catch {}
  try {
    const raw = localStorage.getItem(SILICON_WECHAT_HOOKS_SHARED_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj.silicon = v;
    localStorage.setItem(SILICON_WECHAT_HOOKS_SHARED_KEY, JSON.stringify(obj));
  } catch {}
}

function computeSiliconWorkOrder(order: any, items: Array<{ grade: Grade }>): WorkOrderData {
  const orderNo: string = order?.external_order_id || "";
  const c: Record<Grade, number> = { COMMON: 0, RARE: 0, EPIC: 0, LEGEND: 0 };
  for (const it of items) c[it.grade] = (c[it.grade] || 0) + 1;
  const sd = order?.source_data || {};
  const defaults: WorkOrderData = {
    company: "TWINMETA",
    orderNo,
    orderDate: (order?.created_at || "").slice(0, 10),
    deliveryDate: (order?.project_completed_at || "").slice(0, 10),
    common: c.COMMON, rare: c.RARE, epic: c.EPIC, legend: c.LEGEND,
    total: items.length || order?.quantity || 0,
    recipient: "TWINMETA",
    phone: "18562757070",
    address: "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
    notes: sd.notes || sd.special_notes || sd.memo || "",
  };
  try {
    const raw = orderNo ? localStorage.getItem(`silicon.workOrder.v1.${orderNo}`) : null;
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

// ============= 시안 PDF 생성 (모듈 레벨 헬퍼) =============
const MARK_ORIG_W = 63;
const MARK_ORIG_H = 60.811;
const MARK_AR = MARK_ORIG_H / MARK_ORIG_W;
const A4_W_MM = 210;
const A4_H_MM = 297;
const QR_MARGIN_MM = 10;

export function getTwinLayoutInfo(proof: ProofSettings, itemCount: number) {
  const tCols = Math.max(1, proof.twinCols);
  const tRows = Math.max(1, proof.twinRows);
  const cellW = Math.max(1, proof.markW);
  const cellH = cellW * MARK_AR;
  const perPage = tCols * tRows;
  const totalPages = Math.max(1, Math.ceil(itemCount / perPage));
  return { tCols, tRows, cellW, cellH, perPage, totalPages };
}

export function getQrLayoutInfo(proof: ProofSettings, itemCount: number) {
  const qCols = Math.max(1, Math.floor((A4_W_MM - 2 * QR_MARGIN_MM + proof.qrGap) / (proof.qrCutSize + proof.qrGap)));
  const qRows = Math.max(1, Math.floor((A4_H_MM - 2 * QR_MARGIN_MM + proof.qrGap) / (proof.qrCutSize + proof.qrGap)));
  const perPage = qCols * qRows;
  const totalPages = Math.max(1, Math.ceil(itemCount / perPage));
  return { qCols, qRows, perPage, totalPages };
}

/** 트윈코드 시안: 단일 페이지 PDF (트윈코드 설정의 대지 사이즈 그대로) */
export async function buildSiliconTwinPdfPage(opts: {
  items: ProofItem[];
  pageIdx: number;
  proof: ProofSettings;
  templates: Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>;
  gradeColorNames: GradeColorNames;
  gradeColorStyle: GradeColorStyle;
  overrideTwinSvgUrl?: string | null;
}): Promise<Uint8Array> {
  const { items, pageIdx, proof, templates, gradeColorNames, gradeColorStyle, overrideTwinSvgUrl } = opts;
  const { tCols, tRows, cellW, cellH, perPage } = getTwinLayoutInfo(proof, items.length);
  const tGap = proof.twinGap;

  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvBold = await out.embedFont(StandardFonts.HelveticaBold);

  const pageItems = items.slice(pageIdx * perPage, pageIdx * perPage + perPage);

  const gradeEmbeds: Partial<Record<Grade, any>> = {};
  for (const it of pageItems) {
    const tmpl = templates[it.grade];
    if (tmpl?.bytes && !gradeEmbeds[it.grade]) {
      try {
        const [emb] = await out.embedPdf(tmpl.bytes);
        gradeEmbeds[it.grade] = emb;
      } catch (e) { console.warn("template embed failed", e); }
    }
  }

  let effCellWmm = cellW;
  let effCellHmm = cellH;
  for (const g of Object.keys(gradeEmbeds) as Grade[]) {
    const emb = gradeEmbeds[g];
    if (!emb) continue;
    const wMm = emb.width / MM;
    const hMm = emb.height / MM;
    if (wMm > effCellWmm) effCellWmm = wMm;
    if (hMm > effCellHmm) effCellHmm = hMm;
  }

  const textHmm = Math.max(0, proof.twinTextSize);
  const textBlockMm = proof.twinTextGap + textHmm;
  const marginMm = Math.max(0, proof.twinMargin);
  const cellTotalHmm = effCellHmm + textBlockMm;

  const pageWmm = tCols * effCellWmm + Math.max(0, tCols - 1) * tGap + 2 * marginMm;
  const pageHmm = tRows * cellTotalHmm + Math.max(0, tRows - 1) * tGap + 2 * marginMm;
  const pageWpt = pageWmm * MM;
  const pageHpt = pageHmm * MM;
  const page = out.addPage([pageWpt, pageHpt]);

  const twinEmbedCache = new Map<string, any>();
  const getTwinEmbed = async (url: string) => {
    if (twinEmbedCache.has(url)) return twinEmbedCache.get(url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("svg fetch failed");
      const svgText = await res.text();
      const sizePt = 200;
      const pdfBytes = await svgToVectorPdfBytes(svgText, sizePt, sizePt);
      const [embedded] = await out.embedPdf(pdfBytes);
      twinEmbedCache.set(url, embedded);
      return embedded;
    } catch (e) { console.warn("twin svg embed failed", url, e); return null; }
  };

  for (let idx = 0; idx < pageItems.length; idx++) {
    const it = pageItems[idx];
    const col = idx % tCols;
    const row = Math.floor(idx / tCols);
    const cellXmm = marginMm + col * (effCellWmm + tGap);
    const cellYmm = marginMm + row * (cellTotalHmm + tGap);

    const emb = gradeEmbeds[it.grade];
    const drawWmm = emb ? (emb.width / MM) : cellW;
    const drawHmm = emb ? (emb.height / MM) : cellH;
    const xMm = cellXmm + (effCellWmm - drawWmm) / 2;
    const yMm = cellYmm + (effCellHmm - drawHmm) / 2;

    const twinMm = proof.twinSize;
    const offX = proof.twinOffsetX;
    const offY = proof.twinOffsetY;

    const xPt = xMm * MM;
    const yPt = pageHpt - (yMm + drawHmm) * MM;
    const wPt = drawWmm * MM;
    const hPt = drawHmm * MM;

    if (emb) {
      try { page.drawPage(emb, { x: xPt, y: yPt, width: wPt, height: hPt }); }
      catch (e) { console.warn("template draw failed", e); }
    } else {
      page.drawRectangle({ x: xPt, y: yPt, width: wPt, height: hPt, borderColor: rgb(0.7,0.7,0.7), borderWidth: 0.3 });
    }

    const twinUrl = overrideTwinSvgUrl || it.svgUrl;
    if (twinUrl) {
      const tEmb = await getTwinEmbed(twinUrl);
      if (tEmb) {
        const txMm = xMm + drawWmm / 2 + offX - twinMm / 2;
        const tyMm = yMm + drawHmm / 2 + offY - twinMm / 2;
        const txPt = txMm * MM;
        const tyPt = pageHpt - (tyMm + twinMm) * MM;
        const twPt = twinMm * MM;
        page.drawPage(tEmb, { x: txPt, y: tyPt, width: twPt, height: twPt });
      }
    }

    const fontPt = Math.max(4, proof.twinTextSize * MM);
    const baselineYmm = cellYmm + effCellHmm + proof.twinTextGap + textHmm;
    const colorName = gradeColorNames[it.grade] || "";
    const idText = it.uniqueNo;
    const colorFontPt = gradeColorStyle.fontSize;
    const colorFont = gradeColorStyle.fontWeight >= 650 ? helvBold : helv;
    const sepText = colorName ? "  ·  " : "";
    const sepFontPt = colorName ? Math.max(fontPt, colorFontPt) : fontPt;
    const sepFont = colorFont;
    const idW = helv.widthOfTextAtSize(idText, fontPt);
    const sepW = colorName ? sepFont.widthOfTextAtSize(sepText, sepFontPt) : 0;
    const colorW = colorName ? colorFont.widthOfTextAtSize(colorName, colorFontPt) : 0;
    const totalW = idW + sepW + colorW;
    const startX = (cellXmm + effCellWmm / 2) * MM - totalW / 2;
    const textYpt = pageHpt - baselineYmm * MM;
    page.drawText(idText, { x: startX, y: textYpt, size: fontPt, font: helv, color: rgb(0, 0, 0) });
    if (colorName) {
      page.drawText(sepText, { x: startX + idW, y: textYpt, size: sepFontPt, font: sepFont, color: rgb(0, 0, 0) });
      page.drawText(colorName, { x: startX + idW + sepW, y: textYpt, size: colorFontPt, font: colorFont, color: rgb(0, 0, 0) });
    }
  }

  return await out.save();
}

/** 큐알코드 시안: 1개 PDF 안에 A4 여러 페이지 */
export async function buildSiliconQrPdfAll(opts: {
  items: ProofItem[];
  proof: ProofSettings;
  qrMap: Record<string, string>;
  gradeColorNames: GradeColorNames;
  gradeColorStyle: GradeColorStyle;
}): Promise<Uint8Array> {
  const { items, proof, qrMap, gradeColorNames, gradeColorStyle } = opts;
  const { qCols, perPage, totalPages } = getQrLayoutInfo(proof, items.length);

  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvBold = await out.embedFont(StandardFonts.HelveticaBold);

  const pageWpt = A4_W_MM * MM;
  const pageHpt = A4_H_MM * MM;

  const qrCache = new Map<string, any>();
  const getQrEmbed = async (uniqueNo: string) => {
    if (qrCache.has(uniqueNo)) return qrCache.get(uniqueNo);
    let dataUrl = qrMap[uniqueNo];
    if (!dataUrl) {
      dataUrl = await QRCode.toDataURL(uniqueNo, { errorCorrectionLevel: "M", margin: 0, width: 400 });
    }
    const b64 = dataUrl.split(",")[1] || "";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const img = await out.embedPng(bytes);
    qrCache.set(uniqueNo, img);
    return img;
  };

  for (let p = 0; p < totalPages; p++) {
    const page = out.addPage([pageWpt, pageHpt]);
    const pageItems = items.slice(p * perPage, p * perPage + perPage);
    for (let idx = 0; idx < pageItems.length; idx++) {
      const it = pageItems[idx];
      const col = idx % qCols;
      const row = Math.floor(idx / qCols);
      const cellXmm = QR_MARGIN_MM + col * (proof.qrCutSize + proof.qrGap);
      const cellYmm = QR_MARGIN_MM + row * (proof.qrCutSize + proof.qrGap);

      page.drawRectangle({
        x: cellXmm * MM,
        y: pageHpt - (cellYmm + proof.qrCutSize) * MM,
        width: proof.qrCutSize * MM,
        height: proof.qrCutSize * MM,
        borderColor: rgb(0.4, 0.4, 0.4),
        borderWidth: 0.3,
        borderDashArray: [2, 2],
      });

      const labelMm = Math.max(0, proof.qrTextSize);
      const gapMm = Math.max(0, proof.qrTextGap);
      const avail = Math.max(2, proof.qrCutSize - labelMm - gapMm);
      const qrSizeMm = Math.min(proof.qrSize, avail);
      const blockH = qrSizeMm + gapMm + labelMm;
      const blockTopYmm = cellYmm + (proof.qrCutSize - blockH) / 2;
      const qrXmm = cellXmm + (proof.qrCutSize - qrSizeMm) / 2;
      const qrYmm = blockTopYmm;

      try {
        const qrImg = await getQrEmbed(it.uniqueNo);
        page.drawImage(qrImg, {
          x: qrXmm * MM,
          y: pageHpt - (qrYmm + qrSizeMm) * MM,
          width: qrSizeMm * MM,
          height: qrSizeMm * MM,
        });
      } catch (e) { console.warn("qr embed failed", it.uniqueNo, e); }

      const fontPt = Math.max(4, labelMm * MM);
      const colorName = gradeColorNames[it.grade] || "";
      const colorFontPt = gradeColorStyle.fontSize;
      const colorFont = gradeColorStyle.fontWeight >= 650 ? helvBold : helv;
      const sepText = colorName ? "  ·  " : "";
      const sepFontPt = colorName ? Math.max(fontPt, colorFontPt) : fontPt;
      const idText = it.uniqueNo;
      const idW = helv.widthOfTextAtSize(idText, fontPt);
      const sepW = colorName ? colorFont.widthOfTextAtSize(sepText, sepFontPt) : 0;
      const colorW = colorName ? colorFont.widthOfTextAtSize(colorName, colorFontPt) : 0;
      const totalW = idW + sepW + colorW;
      const labelYmm = blockTopYmm + qrSizeMm + gapMm + labelMm;
      const labelXpt = (cellXmm + proof.qrCutSize / 2) * MM - totalW / 2;
      const labelYpt = pageHpt - labelYmm * MM;
      page.drawText(idText, { x: labelXpt, y: labelYpt, size: fontPt, font: helv, color: rgb(0, 0, 0) });
      if (colorName) {
        page.drawText(sepText, { x: labelXpt + idW, y: labelYpt, size: sepFontPt, font: colorFont, color: rgb(0, 0, 0) });
        page.drawText(colorName, { x: labelXpt + idW + sepW, y: labelYpt, size: colorFontPt, font: colorFont, color: rgb(0, 0, 0) });
      }
    }
  }

  return await out.save();
}

/** Step 2: 트윈코드 / QR코드 최종 PDF 미리보기 다이얼로그 */
async function renderPdfPageToPng(bytes: Uint8Array, pageNum: number, scale = 1.5): Promise<string> {
  const doc = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas.toDataURL("image/png");
}

async function renderPdfAllPagesToPng(bytes: Uint8Array, scale = 1.5): Promise<string[]> {
  const doc = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    out.push(canvas.toDataURL("image/png"));
  }
  return out;
}

function Step2PdfPreviewDialog({
  open, onOpenChange, items, proof, templates, qrMap, gradeColorNames, gradeColorStyle, orderNo, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: ProofItem[];
  proof: ProofSettings;
  templates: Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>;
  qrMap: Record<string, string>;
  gradeColorNames: GradeColorNames;
  gradeColorStyle: GradeColorStyle;
  orderNo: string;
  onConfirm: () => void;
}) {
  const { totalPages: totalTwin } = useMemo(() => getTwinLayoutInfo(proof, items.length), [proof, items.length]);
  const { totalPages: totalQr } = useMemo(() => getQrLayoutInfo(proof, items.length), [proof, items.length]);

  const [twinImgs, setTwinImgs] = useState<(string | null)[]>([]);
  const [twinIdx, setTwinIdx] = useState(0);
  const [twinBusy, setTwinBusy] = useState(false);

  const [qrImgs, setQrImgs] = useState<string[]>([]);
  const [qrIdx, setQrIdx] = useState(0);
  const [qrBusy, setQrBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setTwinImgs([]); setTwinIdx(0); setQrImgs([]); setQrIdx(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || items.length === 0) return;
    let cancelled = false;
    (async () => {
      setTwinBusy(true);
      try {
        const imgs: (string | null)[] = new Array(totalTwin).fill(null);
        setTwinImgs([...imgs]);
        for (let p = 0; p < totalTwin; p++) {
          const bytes = await buildSiliconTwinPdfPage({
            items, pageIdx: p, proof, templates, gradeColorNames, gradeColorStyle,
          });
          if (cancelled) return;
          imgs[p] = await renderPdfPageToPng(bytes, 1, 1.5);
          if (cancelled) return;
          setTwinImgs([...imgs]);
        }
      } catch (e: any) {
        toast({ title: "트윈코드 PDF 생성 실패", description: e?.message, variant: "destructive" });
      } finally { if (!cancelled) setTwinBusy(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, proof, templates, gradeColorNames, gradeColorStyle, totalTwin]);

  useEffect(() => {
    if (!open || items.length === 0) return;
    let cancelled = false;
    (async () => {
      setQrBusy(true);
      try {
        const bytes = await buildSiliconQrPdfAll({ items, proof, qrMap, gradeColorNames, gradeColorStyle });
        if (cancelled) return;
        const imgs = await renderPdfAllPagesToPng(bytes, 1.5);
        if (cancelled) return;
        setQrImgs(imgs);
      } catch (e: any) {
        toast({ title: "QR PDF 생성 실패", description: e?.message, variant: "destructive" });
      } finally { if (!cancelled) setQrBusy(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, proof, qrMap, gradeColorNames, gradeColorStyle]);

  const currentTwinImg = twinImgs[twinIdx] || null;
  const currentQrImg = qrImgs[qrIdx] || null;
  const loadedTwin = twinImgs.filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-green-600" />
            작업파일 확인 — 최종 출력 PDF 미리보기 ({items.length}건)
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="twin" className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <TabsList className="self-start shrink-0">
            <TabsTrigger value="twin"><FileText className="w-4 h-4 mr-1" /> 트윈코드 시안 ({totalTwin}장)</TabsTrigger>
            <TabsTrigger value="qr"><QrCode className="w-4 h-4 mr-1" /> QR코드 시안 ({totalQr}장)</TabsTrigger>
          </TabsList>

          <TabsContent value="twin" className="flex-1 flex flex-col overflow-hidden mt-2">
            <div className="shrink-0 flex items-center justify-between gap-2 pb-2">
              <div className="text-xs text-muted-foreground">
                파일명 미리보기: <span className="font-mono text-foreground">{orderNo || "twincode"}({twinIdx + 1}).pdf</span>
                {twinBusy && <span className="ml-2 inline-flex items-center text-amber-600"><Loader2 className="w-3 h-3 mr-1 animate-spin" />생성 중 ({loadedTwin}/{totalTwin})</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={twinIdx <= 0} onClick={() => setTwinIdx(twinIdx - 1)}>이전</Button>
                <span className="text-xs tabular-nums w-16 text-center">{twinIdx + 1} / {totalTwin}</span>
                <Button size="sm" variant="outline" disabled={twinIdx >= totalTwin - 1} onClick={() => setTwinIdx(twinIdx + 1)}>다음</Button>
              </div>
            </div>
            <div className="flex-1 min-h-0 border rounded-md bg-muted/30 overflow-hidden flex items-center justify-center p-2">
              {currentTwinImg ? (
                <img src={currentTwinImg} alt={`twin-page-${twinIdx + 1}`} className="block w-full h-full object-contain bg-white" />
              ) : (
                <div className="text-sm text-muted-foreground flex items-center">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> 페이지 생성 중...
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="qr" className="flex-1 flex flex-col overflow-hidden mt-2">
            <div className="shrink-0 flex items-center justify-between gap-2 pb-2">
              <div className="text-xs text-muted-foreground">
                파일명 미리보기: <span className="font-mono text-foreground">QRcode.pdf</span>
                <span className="ml-2">· A4 {totalQr}페이지 / 단일 PDF</span>
                {qrBusy && <span className="ml-2 inline-flex items-center text-amber-600"><Loader2 className="w-3 h-3 mr-1 animate-spin" />생성 중</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={qrIdx <= 0} onClick={() => setQrIdx(qrIdx - 1)}>이전</Button>
                <span className="text-xs tabular-nums w-16 text-center">{qrIdx + 1} / {totalQr}</span>
                <Button size="sm" variant="outline" disabled={qrIdx >= totalQr - 1} onClick={() => setQrIdx(qrIdx + 1)}>다음</Button>
              </div>
            </div>
            <div className="flex-1 min-h-0 border rounded-md bg-muted/30 overflow-hidden flex items-center justify-center p-2">
              {currentQrImg ? (
                <img src={currentQrImg} alt={`qr-page-${qrIdx + 1}`} className="block w-full h-full object-contain bg-white" />
              ) : (
                <div className="text-sm text-muted-foreground flex items-center">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> PDF 생성 중...
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
        <div className="shrink-0 flex justify-end gap-2 pt-2 border-t mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
          <Button onClick={onConfirm} disabled={twinBusy || qrBusy}>
            <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


function SiliconOrderProgressBox({
  order, items, templates,
  proof, setProof, proofQrMap, proofPage, setProofPage, proofQrPage, setProofQrPage,
}: {
  order: any;
  items: Array<{ seq: number; uniqueNo: string; grade: Grade }>;
  templates: Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>;
  proof: ProofSettings;
  setProof: React.Dispatch<React.SetStateAction<ProofSettings>>;
  proofQrMap: Record<string, string>;
  proofPage: number;
  setProofPage: (n: number) => void;
  proofQrPage: number;
  setProofQrPage: (n: number) => void;
}) {
  const orderNo: string = order?.external_order_id || "";
  const stateKey = `silicon.progress.v1.${orderNo}`;
  const [confirmed1, setConfirmed1] = useState(false);
  const [confirmed2, setConfirmed2] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [open1, setOpen1] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string>(() => readSiliconWebhook());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onFocus = () => setWebhookUrl(readSiliconWebhook());
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
      } else { setConfirmed1(false); setConfirmed2(false); setOrdered(false); }
    } catch {}
  }, [stateKey]);

  const persist = (next: { confirmed1?: boolean; confirmed2?: boolean; ordered?: boolean }) => {
    const merged = { confirmed1, confirmed2, ordered, ...next };
    try { localStorage.setItem(stateKey, JSON.stringify(merged)); } catch {}
  };

  const colorNames = useMemo<GradeColorNames>(() => {
    try {
      const raw = localStorage.getItem(GRADE_COLOR_LS_KEY);
      if (raw) return { ...DEFAULT_GRADE_COLOR_NAMES, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_GRADE_COLOR_NAMES;
  }, [open1]);
  const colorStyle = useMemo<GradeColorStyle>(() => {
    try {
      const raw = localStorage.getItem(GRADE_COLOR_STYLE_LS_KEY);
      if (raw) return { ...DEFAULT_GRADE_COLOR_STYLE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_GRADE_COLOR_STYLE;
  }, [open1]);

  const woData = useMemo(() => computeSiliconWorkOrder(order, items), [order, items]);
  const woHtml = useMemo(
    () => buildSiliconWorkOrderHtml(woData, templates, colorNames, colorStyle),
    [woData, templates, colorNames, colorStyle],
  );

  const saveWebhook = () => {
    writeSiliconWebhook(webhookUrl);
    toast({ title: "위챗 Webhook 저장됨" });
    setSettingsOpen(false);
  };

  // ProofItem 형태로 변환 (svgUrl 포함)
  const proofItems = useMemo<ProofItem[]>(
    () => items.map((it: any) => ({
      seq: it.seq,
      orderNo,
      uniqueNo: it.uniqueNo,
      grade: it.grade,
      svgUrl: it.svgUrl ?? it.svg_url ?? null,
    })),
    [items, orderNo],
  );

  const sendOrder = async () => {
    if (!webhookUrl) {
      toast({ title: "위챗 Webhook 미설정", description: "발주 전 위챗 Webhook을 먼저 설정하세요.", variant: "destructive" as any });
      setSettingsOpen(true);
      return;
    }
    setSending(true);
    try {
      const zip = new JSZip();
      const folderName = orderNo || "silicon";
      const folder = zip.folder(folderName)!;

      // 1) Work order.pdf
      const woPdfBytes = await renderHtmlToPdfBytes(woHtml);
      folder.file("Work order.pdf", woPdfBytes);

      // 2) TPU mark/ 폴더 — 트윈코드 시안 페이지별 1개 PDF
      const tpuFolder = folder.folder("TPU mark")!;
      const { totalPages: totalTwin } = getTwinLayoutInfo(proof, proofItems.length);
      for (let p = 0; p < totalTwin; p++) {
        const bytes = await buildSiliconTwinPdfPage({
          items: proofItems, pageIdx: p, proof, templates,
          gradeColorNames: colorNames, gradeColorStyle: colorStyle,
        });
        tpuFolder.file(`${folderName}(${p + 1}).pdf`, bytes);
      }

      // 3) QRcode.pdf — 단일 PDF에 A4 여러 페이지
      const qrBytes = await buildSiliconQrPdfAll({
        items: proofItems, proof, qrMap: proofQrMap,
        gradeColorNames: colorNames, gradeColorStyle: colorStyle,
      });
      folder.file("QRcode.pdf", qrBytes);

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipName = `${folderName}.zip`;
      const path = `orders/silicon-${folderName}-${Date.now()}.zip`;
      const { error: upErr } = await supabase.storage.from("hologram-pdf").upload(path, zipBlob, {
        contentType: "application/zip", upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("hologram-pdf").getPublicUrl(path);
      const url = pub.publicUrl;

      const message =
`【실리콘 마크 발주】
작업번호: ${orderNo}
수량: ${items.length}건 / 트윈코드 ${totalTwin}장
파일: ${zipName}
다운로드: ${url}`;

      const { data, error } = await supabase.functions.invoke("wechat-send", {
        body: { webhookUrl, message },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      setOrdered(true); persist({ ordered: true });

      try {
        await supabase.from("outsource_orders").insert({
          factory: "silicon",
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
            <DialogHeader><DialogTitle>작업지시서 미리보기 (A4)</DialogTitle></DialogHeader>
            <div className="flex-1 overflow-auto border rounded-md bg-white">
              <iframe title="silicon-work-order-preview" srcDoc={woHtml} className="w-full h-[70vh] bg-white" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen1(false)}>닫기</Button>
              <Button onClick={() => { setConfirmed1(true); persist({ confirmed1: true }); setOpen1(false); toast({ title: "작업지시서 확인 완료" }); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Step 2 Dialog — 실제 최종 출력 PDF 미리보기 (트윈코드 / QR코드) */}
        <Step2PdfPreviewDialog
          open={open2}
          onOpenChange={setOpen2}
          items={proofItems}
          proof={proof}
          templates={templates}
          qrMap={proofQrMap}
          gradeColorNames={colorNames}
          gradeColorStyle={colorStyle}
          orderNo={orderNo}
          onConfirm={() => { setConfirmed2(true); persist({ confirmed2: true }); setOpen2(false); toast({ title: "작업파일 확인 완료" }); }}
        />


        {/* Webhook settings dialog */}
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>실리콘 마크 공장 위챗 Webhook</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs">기업위챗 그룹봇 Webhook URL</Label>
              <Input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
              <p className="text-xs text-muted-foreground">발주 시 이 그룹채팅으로 ZIP 다운로드 링크가 전송됩니다.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>취소</Button>
              <Button onClick={saveWebhook}><Send className="w-4 h-4 mr-1" /> 저장</Button>
            </div>
          </DialogContent>
        </Dialog>
        {sending && (
          <div className="mt-3 flex items-center text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" /> 발주 전송 중...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ProofItem { seq: number; orderNo: string; uniqueNo: string; svgUrl: string | null; grade: Grade; }
interface ProofSettings {
  twinSize: number; twinCols: number; twinRows: number; twinGap: number; twinMargin: number;
  twinOffsetX: number; twinOffsetY: number; twinTextSize: number; twinTextGap: number;
  markW: number;
  qrSize: number; qrCutSize: number; qrGap: number; qrTextSize: number; qrTextGap: number;
}

function ProofBox({
  items, templates, proof, setProof, qrMap, page, setPage, qrPage, setQrPage, order,
}: {
  items: ProofItem[];
  templates: Record<Grade, { name: string; bytes: Uint8Array; preview: string; aspect: number } | null>;
  proof: ProofSettings;
  setProof: React.Dispatch<React.SetStateAction<ProofSettings>>;
  qrMap: Record<string, string>;
  page: number; setPage: (n: number) => void;
  qrPage: number; setQrPage: (n: number) => void;
  order?: any;
}) {

  const PAPER_W_PX = 640;
  const A4_W = 210, A4_H = 297;
  const MARK_ORIG_W = 63, MARK_ORIG_H = 60.811; // 업로드된 PDF(벡터) 원본 사이즈
  const MARK_AR = MARK_ORIG_H / MARK_ORIG_W;
  const mmPx = PAPER_W_PX / A4_W;
  const paperHpx = A4_H * mmPx;

  // ===== 트윈코드 시안 (마크 크기는 사용자 조절, 비율 고정) =====
  const tCols = Math.max(1, proof.twinCols);
  const tRows = Math.max(1, proof.twinRows);
  const tGap = proof.twinGap;
  const cellW = Math.max(1, proof.markW);
  const cellH = cellW * MARK_AR;
  const perPageT = tCols * tRows;
  const totalPagesT = Math.max(1, Math.ceil(items.length / perPageT));
  const pageT = Math.min(page, totalPagesT - 1);
  const pageItemsT = items.slice(pageT * perPageT, pageT * perPageT + perPageT);

  // ===== QR 시안 =====
  const qMargin = 10;
  const qCols = Math.max(1, Math.floor((A4_W - 2 * qMargin + proof.qrGap) / (proof.qrCutSize + proof.qrGap)));
  const qRows = Math.max(1, Math.floor((A4_H - 2 * qMargin + proof.qrGap) / (proof.qrCutSize + proof.qrGap)));
  const perPageQ = qCols * qRows;
  const totalPagesQ = Math.max(1, Math.ceil(items.length / perPageQ));
  const pageQ = Math.min(qrPage, totalPagesQ - 1);
  const pageItemsQ = items.slice(pageQ * perPageQ, pageQ * perPageQ + perPageQ);

  // ===== 작업지시서 설정 =====
  const orderNo: string = order?.external_order_id || items[0]?.orderNo || "";
  const WO_LS_KEY = `silicon.workOrder.v1.${orderNo}`;
  const gradeCountsFromItems = useMemo(() => {
    const c: Record<Grade, number> = { COMMON: 0, RARE: 0, EPIC: 0, LEGEND: 0 };
    for (const it of items) c[it.grade] = (c[it.grade] || 0) + 1;
    return c;
  }, [items]);
  const woDefaults = useMemo(() => {
    const sd = order?.source_data || {};
    return {
      company: "TWINMETA",
      orderNo,
      orderDate: (order?.created_at || "").slice(0, 10),
      deliveryDate: (order?.project_completed_at || "").slice(0, 10),
      common: gradeCountsFromItems.COMMON,
      rare: gradeCountsFromItems.RARE,
      epic: gradeCountsFromItems.EPIC,
      legend: gradeCountsFromItems.LEGEND,
      total: items.length || order?.quantity || 0,
      recipient: "TWINMETA",
      phone: "18562757070",
      address: "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
      notes: sd.notes || sd.special_notes || sd.memo || "",
    };
  }, [order, items, gradeCountsFromItems, orderNo]);
  const [workOrder, setWorkOrder] = useState(woDefaults);
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" && orderNo ? localStorage.getItem(WO_LS_KEY) : null;
      if (raw) setWorkOrder({ ...woDefaults, ...JSON.parse(raw) });
      else setWorkOrder(woDefaults);
    } catch { setWorkOrder(woDefaults); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo]);
  const setWO = (patch: Partial<typeof workOrder>) => setWorkOrder(prev => ({ ...prev, ...patch }));
  const woTotal = (Number(workOrder.common) || 0) + (Number(workOrder.rare) || 0) + (Number(workOrder.epic) || 0) + (Number(workOrder.legend) || 0);

  // ===== 등급별 색상명 (전역 설정) =====
  const [gradeColorNames, setGradeColorNames] = useState<GradeColorNames>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(GRADE_COLOR_LS_KEY) : null;
      if (raw) return { ...DEFAULT_GRADE_COLOR_NAMES, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_GRADE_COLOR_NAMES;
  });
  const setGradeColor = (g: Grade, v: string) => setGradeColorNames(prev => ({ ...prev, [g]: v }));
  const [gradeColorStyle, setGradeColorStyle] = useState<GradeColorStyle>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(GRADE_COLOR_STYLE_LS_KEY) : null;
      if (raw) return { ...DEFAULT_GRADE_COLOR_STYLE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_GRADE_COLOR_STYLE;
  });
  const labelFor = (it: ProofItem) => {
    const c = gradeColorNames[it.grade];
    if (!c) return <>{it.uniqueNo}</>;
    return (
      <>
        {it.uniqueNo} · <span style={{ fontSize: `${gradeColorStyle.fontSize}px`, fontWeight: gradeColorStyle.fontWeight }}>{c}</span>
      </>
    );
  };
  const labelText = (it: ProofItem) => {
    const c = gradeColorNames[it.grade];
    return c ? `${it.uniqueNo} · ${c}` : it.uniqueNo;
  };

  // ===== 트윈코드 테스트 SVG (업로드 시 모든 마크에 동일 적용) =====
  const [testTwinSvg, setTestTwinSvg] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => () => { if (testTwinSvg?.url) URL.revokeObjectURL(testTwinSvg.url); }, [testTwinSvg]);
  const handleTestSvgUpload = (file: File) => {
    if (!file) return;
    if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
      toast({ title: "SVG 파일만 업로드 가능합니다", variant: "destructive" });
      return;
    }
    if (testTwinSvg?.url) URL.revokeObjectURL(testTwinSvg.url);
    const url = URL.createObjectURL(file);
    setTestTwinSvg({ url, name: file.name });
    toast({ title: "테스트 트윈코드 적용됨", description: `모든 마크에 ${file.name} 표시` });
  };
  const clearTestSvg = () => {
    if (testTwinSvg?.url) URL.revokeObjectURL(testTwinSvg.url);
    setTestTwinSvg(null);
    toast({ title: "테스트 트윈코드 제거됨", description: "API 트윈코드로 복원됩니다" });
  };

  // ===== 트윈코드 시안 PDF 생성 (벡터) =====
  const [pdfBusy, setPdfBusy] = useState(false);

  const buildTwinPdfBytesForPage = async (pageIdx: number): Promise<Uint8Array> => {
    const out = await PDFDocument.create();
    const helv = await out.embedFont(StandardFonts.Helvetica);
    const helvBold = await out.embedFont(StandardFonts.HelveticaBold);

    const pageItems = items.slice(pageIdx * perPageT, pageIdx * perPageT + perPageT);

    // cache embeds
    const tmplEmbedCache = new Map<string, any>();
    const getTmplEmbed = async (bytes: Uint8Array) => {
      const key = `g${bytes.byteLength}`;
      if (tmplEmbedCache.has(key)) return tmplEmbedCache.get(key);
      const [embedded] = await out.embedPdf(bytes);
      tmplEmbedCache.set(key, embedded);
      return embedded;
    };

    // Pre-embed all templates used on this page so we know their native size.
    const gradeEmbeds: Partial<Record<Grade, any>> = {};
    for (const it of pageItems) {
      const tmpl = templates[it.grade];
      if (tmpl?.bytes && !gradeEmbeds[it.grade]) {
        try { gradeEmbeds[it.grade] = await getTmplEmbed(tmpl.bytes); } catch (e) { console.warn("tmpl embed failed", e); }
      }
    }

    // Uniform cell size = max native template size across this page (mm). Fallback to user-configured cellW/cellH.
    let effCellWmm = cellW;
    let effCellHmm = cellH;
    for (const g of Object.keys(gradeEmbeds) as Grade[]) {
      const emb = gradeEmbeds[g];
      if (!emb) continue;
      const wMm = emb.width / MM;
      const hMm = emb.height / MM;
      if (wMm > effCellWmm) effCellWmm = wMm;
      if (hMm > effCellHmm) effCellHmm = hMm;
    }

    // Text block height (mm) — included in "대지" so output page contains text.
    const textHmm = Math.max(0, proof.twinTextSize);
    const textBlockMm = proof.twinTextGap + textHmm; // gap from mark bottom + glyph height
    const marginMm = Math.max(0, proof.twinMargin);

    // Effective cell = template + text block below it
    const cellTotalHmm = effCellHmm + textBlockMm;

    // Page = grid content + margin on all sides
    const pageWmm = tCols * effCellWmm + Math.max(0, tCols - 1) * tGap + 2 * marginMm;
    const pageHmm = tRows * cellTotalHmm + Math.max(0, tRows - 1) * tGap + 2 * marginMm;
    const pageWpt = pageWmm * MM;
    const pageHpt = pageHmm * MM;
    const page = out.addPage([pageWpt, pageHpt]);

    const twinEmbedCache = new Map<string, any>();
    const getTwinEmbed = async (url: string) => {
      if (twinEmbedCache.has(url)) return twinEmbedCache.get(url);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("svg fetch failed");
        const svgText = await res.text();
        const sizePt = 200;
        const pdfBytes = await svgToVectorPdfBytes(svgText, sizePt, sizePt);
        const [embedded] = await out.embedPdf(pdfBytes);
        twinEmbedCache.set(url, embedded);
        return embedded;
      } catch (e) {
        console.warn("twin svg embed failed", url, e);
        return null;
      }
    };

    for (let idx = 0; idx < pageItems.length; idx++) {
      const it = pageItems[idx];
      const col = idx % tCols;
      const row = Math.floor(idx / tCols);
      const cellXmm = marginMm + col * (effCellWmm + tGap);
      const cellYmm = marginMm + row * (cellTotalHmm + tGap);

      // Draw template at its native size (no scaling).
      const emb = gradeEmbeds[it.grade];
      const drawWmm = emb ? (emb.width / MM) : cellW;
      const drawHmm = emb ? (emb.height / MM) : cellH;
      // Center horizontally inside the cell; align to top so text sits cleanly below.
      const xMm = cellXmm + (effCellWmm - drawWmm) / 2;
      const yMm = cellYmm + (effCellHmm - drawHmm) / 2;

      const twinMm = proof.twinSize;
      const offX = proof.twinOffsetX;
      const offY = proof.twinOffsetY;

      // pdf-lib origin is bottom-left
      const xPt = xMm * MM;
      const yPt = pageHpt - (yMm + drawHmm) * MM;
      const wPt = drawWmm * MM;
      const hPt = drawHmm * MM;

      if (emb) {
        try { page.drawPage(emb, { x: xPt, y: yPt, width: wPt, height: hPt }); }
        catch (e) { console.warn("template draw failed", e); }
      } else {
        page.drawRectangle({ x: xPt, y: yPt, width: wPt, height: hPt, borderColor: rgb(0.7,0.7,0.7), borderWidth: 0.3 });
      }

      const twinUrl = testTwinSvg?.url || it.svgUrl;
      if (twinUrl) {
        const tEmb = await getTwinEmbed(twinUrl);
        if (tEmb) {
          const txMm = xMm + drawWmm / 2 + offX - twinMm / 2;
          const tyMm = yMm + drawHmm / 2 + offY - twinMm / 2;
          const txPt = txMm * MM;
          const tyPt = pageHpt - (tyMm + twinMm) * MM;
          const twPt = twinMm * MM;
          page.drawPage(tEmb, { x: txPt, y: tyPt, width: twPt, height: twPt });
        }
      }

      // Text BELOW mark, inside the page (margin guarantees no overflow).
      const fontPt = Math.max(4, proof.twinTextSize * MM);
      const baselineYmm = cellYmm + effCellHmm + proof.twinTextGap + textHmm;
      const colorName = gradeColorNames[it.grade] || "";
      const idText = it.uniqueNo;
      const colorFontPt = gradeColorStyle.fontSize; // pt
      const colorFont = gradeColorStyle.fontWeight >= 650 ? helvBold : helv;
      // Draw separator at the LARGER size so spacing scales with color font; add extra padding.
      const sepText = colorName ? "  ·  " : "";
      const sepFontPt = colorName ? Math.max(fontPt, colorFontPt) : fontPt;
      const sepFont = colorFont;
      const idW = helv.widthOfTextAtSize(idText, fontPt);
      const sepW = colorName ? sepFont.widthOfTextAtSize(sepText, sepFontPt) : 0;
      const colorW = colorName ? colorFont.widthOfTextAtSize(colorName, colorFontPt) : 0;
      const totalW = idW + sepW + colorW;
      const startX = (cellXmm + effCellWmm / 2) * MM - totalW / 2;
      const textYpt = pageHpt - baselineYmm * MM;
      page.drawText(idText, { x: startX, y: textYpt, size: fontPt, font: helv, color: rgb(0, 0, 0) });
      if (colorName) {
        page.drawText(sepText, { x: startX + idW, y: textYpt, size: sepFontPt, font: sepFont, color: rgb(0, 0, 0) });
        page.drawText(colorName, { x: startX + idW + sepW, y: textYpt, size: colorFontPt, font: colorFont, color: rgb(0, 0, 0) });
      }
    }

    return await out.save();
  };

  const downloadBlobAs = (bytes: Uint8Array, filename: string) => {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([ab], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadTwinPdfCurrent = async () => {
    if (items.length === 0) { toast({ title: "다운로드할 항목이 없습니다", variant: "destructive" }); return; }
    setPdfBusy(true);
    try {
      const bytes = await buildTwinPdfBytesForPage(pageT);
      downloadBlobAs(bytes, `${orderNo || "twincode"}(${pageT + 1}).pdf`);
      toast({ title: "PDF 다운로드 완료", description: `${orderNo}(${pageT + 1}).pdf` });
    } catch (e: any) {
      toast({ title: "PDF 생성 실패", description: e?.message, variant: "destructive" });
    } finally { setPdfBusy(false); }
  };

  const downloadTwinPdfAll = async () => {
    if (items.length === 0) { toast({ title: "다운로드할 항목이 없습니다", variant: "destructive" }); return; }
    setPdfBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (let p = 0; p < totalPagesT; p++) {
        const bytes = await buildTwinPdfBytesForPage(p);
        zip.file(`${orderNo || "twincode"}(${p + 1}).pdf`, bytes);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url; a.download = `${orderNo || "twincode"}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "일괄 다운로드 완료", description: `${totalPagesT}개 PDF` });
    } catch (e: any) {
      toast({ title: "일괄 다운로드 실패", description: e?.message, variant: "destructive" });
    } finally { setPdfBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">시안 박스 · 공장 발주 파일 확인</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ============== 작업지시서 설정 ============== */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>작업지시서 설정</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="default" onClick={() => {
                  try {
                    localStorage.setItem(WO_LS_KEY, JSON.stringify({ ...workOrder, total: woTotal }));
                    toast({ title: "작업지시서 저장됨" });
                  } catch (e: any) { toast({ title: "저장 실패", description: e?.message, variant: "destructive" }); }
                }}>저장</Button>
                <Button size="sm" variant="outline" onClick={() => printWorkOrder({ ...workOrder, total: woTotal }, templates, gradeColorNames, gradeColorStyle)}>
                  <FileText className="w-4 h-4 mr-1" />작업지시서 출력
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TxtField label="발주업체명" v={workOrder.company} set={v => setWO({ company: v })} />
            <TxtField label="작업번호" v={workOrder.orderNo} set={v => setWO({ orderNo: v })} />
            <div className="grid grid-cols-2 gap-2">
              <TxtField label="발주일" type="date" v={workOrder.orderDate} set={v => setWO({ orderDate: v })} />
              <TxtField label="납품일" type="date" v={workOrder.deliveryDate} set={v => setWO({ deliveryDate: v })} />
            </div>
            <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-5 gap-2">
              <TxtField label="COMMON" type="number" v={String(workOrder.common)} set={v => setWO({ common: Number(v) || 0 })} />
              <TxtField label="RARE" type="number" v={String(workOrder.rare)} set={v => setWO({ rare: Number(v) || 0 })} />
              <TxtField label="EPIC" type="number" v={String(workOrder.epic)} set={v => setWO({ epic: Number(v) || 0 })} />
              <TxtField label="LEGEND" type="number" v={String(workOrder.legend)} set={v => setWO({ legend: Number(v) || 0 })} />
              <div className="space-y-1">
                <Label className="text-xs">총수량</Label>
                <Input value={woTotal} readOnly className="h-9 font-mono bg-muted/50" />
              </div>
            </div>
            <TxtField label="받을사람" v={workOrder.recipient} set={v => setWO({ recipient: v })} />
            <TxtField label="전화번호" v={workOrder.phone} set={v => setWO({ phone: v })} />
            <TxtField label="주소" v={workOrder.address} set={v => setWO({ address: v })} />
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">발주특이사항</Label>
              <Textarea
                value={workOrder.notes}
                onChange={(e) => setWO({ notes: e.target.value })}
                rows={3}
                placeholder="특이사항을 입력하세요"
              />
            </div>
          </CardContent>
        </Card>

        {/* ============== 등급별 색상명 설정 ============== */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>등급별 색상명 설정</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => {
                  setGradeColorNames(DEFAULT_GRADE_COLOR_NAMES);
                  try { localStorage.removeItem(GRADE_COLOR_LS_KEY); } catch {}
                  toast({ title: "색상명 초기화됨" });
                }}>초기화</Button>
                <Button size="sm" variant="default" onClick={() => {
                  try {
                    localStorage.setItem(GRADE_COLOR_LS_KEY, JSON.stringify(gradeColorNames));
                    localStorage.setItem(GRADE_COLOR_STYLE_LS_KEY, JSON.stringify(gradeColorStyle));
                    toast({ title: "등급별 색상명 저장됨" });
                  } catch (e: any) { toast({ title: "저장 실패", description: e?.message, variant: "destructive" }); }
                }}>저장</Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 일괄 타이포그래피 컨트롤 */}
            <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">글자 크기 (모든 등급 일괄)</Label>
                  <span className="text-xs font-mono text-muted-foreground">{gradeColorStyle.fontSize}pt</span>
                </div>
                <Slider
                  min={6} max={36} step={1}
                  value={[gradeColorStyle.fontSize]}
                  onValueChange={([v]) => setGradeColorStyle(s => ({ ...s, fontSize: v }))}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Bold 강도 (모든 등급 일괄)</Label>
                  <span className="text-xs font-mono text-muted-foreground">{gradeColorStyle.fontWeight}</span>
                </div>
                <Slider
                  min={100} max={900} step={100}
                  value={[gradeColorStyle.fontWeight]}
                  onValueChange={([v]) => setGradeColorStyle(s => ({ ...s, fontWeight: v }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(["COMMON","RARE","EPIC","LEGEND"] as Grade[]).map(g => (
                <div key={g} className="space-y-1">
                  <Label className="text-xs flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">{g}</Badge>
                  </Label>
                  <Input
                    value={gradeColorNames[g]}
                    onChange={e => setGradeColor(g, e.target.value)}
                    placeholder="예: 화이트 / 红色 / Black"
                    className="h-9"
                    style={{ fontSize: `${gradeColorStyle.fontSize}px`, fontWeight: gradeColorStyle.fontWeight }}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>


        <Tabs defaultValue="twin">
          <TabsList>
            <TabsTrigger value="twin">트윈코드 시안</TabsTrigger>
            <TabsTrigger value="qr">큐알코드 시안</TabsTrigger>
          </TabsList>


          {/* ============== 트윈코드 시안 ============== */}
          <TabsContent value="twin" className="pt-4 space-y-4">
            <div className="rounded-md border border-dashed p-3 flex items-center justify-between gap-3 flex-wrap bg-muted/30">
              <div className="flex items-center gap-3 flex-wrap">
                <Label className="text-xs font-semibold">트윈코드 테스트 SVG</Label>
                <Input
                  type="file"
                  accept=".svg,image/svg+xml"
                  className="h-9 w-auto max-w-xs cursor-pointer"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTestSvgUpload(f); e.currentTarget.value = ""; }}
                />
                {testTwinSvg && (
                  <div className="flex items-center gap-2 text-xs">
                    <img src={testTwinSvg.url} alt="" className="w-6 h-6 object-contain border bg-background" />
                    <span className="font-mono truncate max-w-[200px]">{testTwinSvg.name}</span>
                    <span className="text-amber-600 dark:text-amber-400">· 모든 마크에 적용 중</span>
                  </div>
                )}
              </div>
              {testTwinSvg ? (
                <Button size="sm" variant="destructive" onClick={clearTestSvg}>테스트 SVG 삭제</Button>
              ) : (
                <span className="text-[11px] text-muted-foreground">업로드 시 모든 마크 포맷에 일괄 표시되어 포맷 확인용으로 사용됩니다. 삭제 시 API 트윈코드로 복원됩니다.</span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="마크 가로(mm)" v={proof.markW} set={v => setProof(p => ({ ...p, markW: v }))} step={0.1} />
              <NumField label="트윈코드 크기(mm)" v={proof.twinSize} set={v => setProof(p => ({ ...p, twinSize: v }))} step={0.1} />
              <NumField label="트윈코드 X 오프셋(mm)" v={proof.twinOffsetX} set={v => setProof(p => ({ ...p, twinOffsetX: v }))} step={0.1} />
              <NumField label="트윈코드 Y 오프셋(mm)" v={proof.twinOffsetY} set={v => setProof(p => ({ ...p, twinOffsetY: v }))} step={0.1} />
              <NumField label="가로 수량" v={proof.twinCols} set={v => setProof(p => ({ ...p, twinCols: v }))} />
              <NumField label="세로 수량" v={proof.twinRows} set={v => setProof(p => ({ ...p, twinRows: v }))} />
              <NumField label="마크 이격(mm)" v={proof.twinGap} set={v => setProof(p => ({ ...p, twinGap: v }))} step={0.1} />
              <NumField label="대지 여백(mm)" v={proof.twinMargin} set={v => setProof(p => ({ ...p, twinMargin: v }))} step={0.1} />
              <NumField label="마크번호 크기(mm)" v={proof.twinTextSize} set={v => setProof(p => ({ ...p, twinTextSize: v }))} step={0.1} />
              <NumField label="마크번호 이격(mm)" v={proof.twinTextGap} set={v => setProof(p => ({ ...p, twinTextGap: v }))} step={0.1} />
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs text-muted-foreground">
                {(() => {
                  const textBlock = proof.twinTextGap + proof.twinTextSize;
                  const cellTotalH = cellH + textBlock;
                  const outW = tCols * cellW + Math.max(0, tCols - 1) * tGap + 2 * proof.twinMargin;
                  const outH = tRows * cellTotalH + Math.max(0, tRows - 1) * tGap + 2 * proof.twinMargin;
                  return (
                    <>대지 사이즈(텍스트 포함): <span className="font-mono text-foreground">{outW.toFixed(2)} × {outH.toFixed(2)} mm</span> · 여백 {proof.twinMargin}mm · 마크 크기: <span className="font-mono text-foreground">{cellW.toFixed(2)} × {cellH.toFixed(2)} mm</span> · 페이지당 {perPageT}개 · 총 {items.length}개 · {totalPagesT}페이지</>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Button size="sm" variant="default" onClick={() => {
                  try { localStorage.setItem(PROOF_LS_KEY, JSON.stringify(proof)); toast({ title: "시안 설정 저장됨" }); }
                  catch (e: any) { toast({ title: "저장 실패", description: e?.message, variant: "destructive" }); }
                }}>설정 저장</Button>
                <Button size="sm" variant="outline" disabled={pageT <= 0} onClick={() => setPage(pageT - 1)}>이전</Button>
                <span className="text-xs tabular-nums w-16 text-center">{pageT + 1} / {totalPagesT}</span>
                <Button size="sm" variant="outline" disabled={pageT >= totalPagesT - 1} onClick={() => setPage(pageT + 1)}>다음</Button>
              </div>
            </div>
            <div className="rounded-md border bg-primary/5 p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs font-semibold flex items-center gap-2">
                <Download className="w-4 h-4 text-primary" />
                PDF 다운로드
                <span className="text-muted-foreground font-normal">· 파일명: 작업번호(페이지번호)</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="secondary" onClick={downloadTwinPdfCurrent} disabled={pdfBusy}>
                  {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  현재 페이지 PDF
                </Button>
                <Button size="sm" variant="default" onClick={downloadTwinPdfAll} disabled={pdfBusy}>
                  {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  전체 PDF (ZIP)
                </Button>
              </div>
            </div>

            <div className="flex justify-center">
              {(() => {
                const marginMm = Math.max(0, proof.twinMargin);
                const textBlock = proof.twinTextGap + proof.twinTextSize;
                const cellTotalH = cellH + textBlock;
                const outWmm = tCols * cellW + Math.max(0, tCols - 1) * tGap + 2 * marginMm;
                const outHmm = tRows * cellTotalH + Math.max(0, tRows - 1) * tGap + 2 * marginMm;
                // Scale so preview width fits PAPER_W_PX
                const fitPx = PAPER_W_PX / outWmm;
                const stageW = outWmm * fitPx;
                const stageH = outHmm * fitPx;
                return (
                  <div className="relative bg-white shadow border" style={{ width: stageW, height: stageH }}>
                    {/* 대지 여백 표시 */}
                    {marginMm > 0 && (
                      <div
                        className="absolute border border-dashed border-muted-foreground/40 pointer-events-none"
                        style={{ left: marginMm * fitPx, top: marginMm * fitPx, width: (outWmm - 2 * marginMm) * fitPx, height: (outHmm - 2 * marginMm) * fitPx }}
                      />
                    )}
                    {pageItemsT.map((it, idx) => {
                      const col = idx % tCols;
                      const row = Math.floor(idx / tCols);
                      const cellXmm = marginMm + col * (cellW + tGap);
                      const cellYmm = marginMm + row * (cellTotalH + tGap);
                      const x = cellXmm * fitPx;
                      const y = cellYmm * fitPx;
                      const w = cellW * fitPx;
                      const h = cellH * fitPx;
                      const tmpl = templates[it.grade];
                      const twinPx = proof.twinSize * fitPx;
                      const offX = proof.twinOffsetX * fitPx;
                      const offY = proof.twinOffsetY * fitPx;
                      return (
                        <div key={it.uniqueNo} className="absolute" style={{ left: x, top: y, width: w, height: h + textBlock * fitPx }}>
                          {/* mark area */}
                          <div className="absolute" style={{ left: 0, top: 0, width: w, height: h }}>
                            {tmpl?.preview ? (
                              <img src={tmpl.preview} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                            ) : (
                              <div className="absolute inset-0 border border-dashed border-muted-foreground/40 flex items-center justify-center text-[9px] text-muted-foreground">
                                {it.grade} 포맷 없음
                              </div>
                            )}
                            <div
                              className="absolute"
                              style={{
                                left: `calc(50% + ${offX}px - ${twinPx / 2}px)`,
                                top: `calc(50% + ${offY}px - ${twinPx / 2}px)`,
                                width: twinPx,
                                height: twinPx,
                              }}
                            >
                              {(testTwinSvg?.url || it.svgUrl) ? (
                                <img src={testTwinSvg?.url || it.svgUrl!} alt="" className="w-full h-full object-contain" />
                              ) : (
                                <div className="w-full h-full border border-dashed border-destructive flex items-center justify-center text-[8px] text-destructive">no svg</div>
                              )}
                            </div>
                          </div>
                          {/* text below mark */}
                          <div
                            className="absolute left-0 right-0 text-center font-mono text-foreground leading-none"
                            style={{ top: h + proof.twinTextGap * fitPx, fontSize: Math.max(6, proof.twinTextSize * fitPx) }}
                          >
                            {labelFor(it)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </TabsContent>


          {/* ============== 큐알코드 시안 ============== */}
          <TabsContent value="qr" className="pt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <NumField label="QR 크기(mm)" v={proof.qrSize} set={v => setProof(p => ({ ...p, qrSize: v }))} step={0.1} />
              <NumField label="칼선 크기(mm)" v={proof.qrCutSize} set={v => setProof(p => ({ ...p, qrCutSize: v }))} step={0.1} />
              <NumField label="QR 간격(mm)" v={proof.qrGap} set={v => setProof(p => ({ ...p, qrGap: v }))} step={0.1} />
              <NumField label="마크번호 크기(mm)" v={proof.qrTextSize} set={v => setProof(p => ({ ...p, qrTextSize: v }))} step={0.1} />
              <NumField label="마크번호 이격(mm)" v={proof.qrTextGap} set={v => setProof(p => ({ ...p, qrTextGap: v }))} step={0.1} />
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs text-muted-foreground">
                출력 사이즈: <span className="font-mono text-foreground">{(qCols * proof.qrCutSize + Math.max(0, qCols - 1) * proof.qrGap).toFixed(2)} × {(qRows * proof.qrCutSize + Math.max(0, qRows - 1) * proof.qrGap).toFixed(2)} mm</span> · {qCols} × {qRows} · 페이지당 {perPageQ}개 · 총 {items.length}개 · {totalPagesQ}페이지
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="default" onClick={() => {
                  try { localStorage.setItem(PROOF_LS_KEY, JSON.stringify(proof)); toast({ title: "시안 설정 저장됨" }); }
                  catch (e: any) { toast({ title: "저장 실패", description: e?.message, variant: "destructive" }); }
                }}>설정 저장</Button>
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
                  const x = (qMargin + col * (proof.qrCutSize + proof.qrGap)) * mmPx;
                  const y = (qMargin + row * (proof.qrCutSize + proof.qrGap)) * mmPx;
                  const cutS = proof.qrCutSize * mmPx;
                  const qrS = proof.qrSize * mmPx;
                  const labelPx = Math.max(6, proof.qrTextSize * mmPx);
                  const gapPx = proof.qrTextGap * mmPx;
                  // QR image fits inside cut line; cap to available space
                  const avail = Math.max(8, cutS - labelPx - gapPx);
                  const qrH = Math.min(qrS, avail);
                  return (
                    <div
                      key={it.uniqueNo}
                      className="absolute border border-dashed border-foreground/60 flex flex-col items-center justify-center"
                      style={{ left: x, top: y, width: cutS, height: cutS }}
                      title={`칼선: ${it.uniqueNo}`}
                    >
                      {qrMap[it.uniqueNo] ? (
                        <img src={qrMap[it.uniqueNo]} alt="qr" style={{ width: qrH, height: qrH }} />
                      ) : (
                        <div style={{ width: qrH, height: qrH }} className="bg-muted" />
                      )}
                      <div
                        className="font-mono text-foreground leading-none"
                        style={{ fontSize: labelPx, marginTop: gapPx }}
                      >
                        {labelFor(it)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground text-center">
              ※ 점선 사각형은 각 QR 라벨의 칼선(크기: {proof.qrCutSize}mm)이며, QR 이미지({proof.qrSize}mm)와 마크 고유번호를 포함합니다.
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
