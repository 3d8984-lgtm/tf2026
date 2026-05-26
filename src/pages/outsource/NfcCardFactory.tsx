import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
(pdfjsLib as any).GlobalWorkerOptions.workerPort = new PdfWorker();

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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Download, Eye, FileText, Loader2, Upload, X, ChevronLeft, Save } from "lucide-react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import bwipjs from "bwip-js/browser";

const MM = 2.8346456693; // 1mm in pt
const CARD_W_MM = 85.6;
const CARD_H_MM = 53.98;
const FRAME_BUCKET = "design-formats";
const FRAME_PREFIX = "nfc-card";
const SETTINGS_KEY_PREFIX = "outsource-nfc-card-v1";
const GLOBAL_LAYOUT_KEY = "outsource-nfc-card-layout-default";

async function renderPdfFirstPagePng(bytes: Uint8Array): Promise<{ dataUrl: string; aspect: number }> {
  const doc = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return { dataUrl: canvas.toDataURL("image/png"), aspect: viewport.width / viewport.height };
}

function fmtDate(v?: string | null): string {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v).slice(0, 10); }
}

function tsName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

type OptionKey =
  | "cpValue" | "editionNo"
  | "issuedNo" | "mintedOn" | "grade" | "issuedBy" | "twincode" | "dmBarcode";

interface OptionLayout {
  enabled: boolean;
  x: number;      // mm from left
  y: number;      // mm from top
  w: number;      // mm
  h: number;      // mm (for images/svg); text uses fontSize
  fontSize: number; // mm (text height)
  centerX: boolean; // 가로정렬(중앙)
  centerY: boolean; // 세로정렬(중앙)
}

const FRONT_KEYS: OptionKey[] = ["cpValue", "editionNo"];
const BACK_KEYS: OptionKey[] = ["issuedNo", "mintedOn", "grade", "issuedBy", "twincode", "dmBarcode"];

const OPTION_LABELS: Record<OptionKey, string> = {
  cpValue: "CP값",
  editionNo: "EDITION No.",
  issuedNo: "ISSUED No.",
  mintedOn: "Minted on",
  grade: "등급",
  issuedBy: "ISSUED BY",
  twincode: "트윈코드",
  dmBarcode: "DM 바코드",
};

const DEFAULT_LAYOUT: Record<OptionKey, OptionLayout> = {
  cpValue:   { enabled: true, x: 10, y: 10,  w: 30, h: 8,  fontSize: 4, centerX: false, centerY: false },
  editionNo: { enabled: true, x: 10, y: 40,  w: 30, h: 6,  fontSize: 3.5, centerX: false, centerY: false },
  issuedNo:  { enabled: true, x: 5,  y: 5,   w: 30, h: 5,  fontSize: 3,   centerX: false, centerY: false },
  mintedOn:  { enabled: true, x: 5,  y: 12,  w: 35, h: 5,  fontSize: 3,   centerX: false, centerY: false },
  grade:     { enabled: true, x: 55, y: 5,   w: 25, h: 6,  fontSize: 4,   centerX: false, centerY: false },
  issuedBy:  { enabled: true, x: 55, y: 35,  w: 25, h: 12, fontSize: 0,   centerX: false, centerY: false },
  twincode:  { enabled: true, x: 5,  y: 25,  w: 22, h: 22, fontSize: 0,   centerX: false, centerY: false },
  dmBarcode: { enabled: true, x: 60, y: 18,  w: 14, h: 14, fontSize: 0,   centerX: false, centerY: false },
};

interface CardData {
  seq: number;
  orderNo: string;
  uniqueNo: string;           // orderNo-4
  uid: string;                // arbitrary UID info
  cpValue: string;
  editionNo: string;
  issuedNo: string;
  mintedOn: string;
  grade: string;
  issuedByUrl: string | null;
  twincodeSvgUrl: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
}

interface OrderRow {
  orderNo: string;
  receivedAt: string;
  dueDate: string;
  recipient: string;
  quantity: number;
}

// ---------- DataMatrix via bwip-js → PNG bytes ----------
async function dataMatrixPngBytes(text: string, sizePx = 300): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  await (bwipjs as any).toCanvas(canvas, {
    bcid: "datamatrix",
    text: text || "TWINMETA",
    scale: 4,
    paddingwidth: 4,
    paddingheight: 4,
    includetext: false,
  });
  // re-render at sizePx
  const out = document.createElement("canvas");
  out.width = sizePx; out.height = sizePx;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sizePx, sizePx);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, sizePx, sizePx);
  const dataUrl = out.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function urlToPngBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  // If it's already PNG, return as is. Otherwise re-render via canvas.
  const blob = new Blob([buf]);
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("img decode failed"));
      i.src = objUrl;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || 400;
    c.height = img.naturalHeight || 400;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const dataUrl = c.toDataURL("image/png");
    const bin = atob(dataUrl.split(",")[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function downloadBlob(bytes: Uint8Array, filename: string, mime = "application/pdf") {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============== MAIN ==============
export default function NfcCardFactory() {
  const { t } = useLang();
  const { user } = useAuth();
  const { data: ordersData, isLoading } = useOrders();
  const [detailOrderNo, setDetailOrderNo] = useState<string | null>(null);
  const [frames, setFrames] = useState<{
    front: { name: string; bytes: Uint8Array; preview: string; aspect: number } | null;
    back: { name: string; bytes: Uint8Array; preview: string; aspect: number } | null;
  }>({ front: null, back: null });

  // Load saved frame PDFs from storage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const side of ["front", "back"] as const) {
        const { data: list } = await supabase.storage.from(FRAME_BUCKET).list(FRAME_PREFIX);
        const found = (list || []).find(f => f.name.startsWith(`${side}__`));
        if (!found) continue;
        const path = `${FRAME_PREFIX}/${found.name}`;
        const { data: file } = await supabase.storage.from(FRAME_BUCKET).download(path);
        if (cancelled || !file) continue;
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          const { dataUrl, aspect } = await renderPdfFirstPagePng(buf);
          if (cancelled) return;
          const name = found.name.replace(/^(front|back)__/, "");
          setFrames(prev => ({ ...prev, [side]: { name, bytes: buf, preview: dataUrl, aspect } }));
        } catch (e) { console.error("frame load fail", e); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onUploadFrame = async (side: "front" | "back", file: File | null) => {
    if (!user?.id) { toast({ title: "로그인 필요", variant: "destructive" }); return; }
    const { data: existing } = await supabase.storage.from(FRAME_BUCKET).list(FRAME_PREFIX);
    const toRemove = (existing || [])
      .filter(f => f.name.startsWith(`${side}__`))
      .map(f => `${FRAME_PREFIX}/${f.name}`);
    if (toRemove.length) await supabase.storage.from(FRAME_BUCKET).remove(toRemove);
    if (!file) { setFrames(prev => ({ ...prev, [side]: null })); return; }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { dataUrl, aspect } = await renderPdfFirstPagePng(buf);
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${FRAME_PREFIX}/${side}__${safe}`;
      const { error } = await supabase.storage.from(FRAME_BUCKET)
        .upload(path, new Blob([buf as BlobPart], { type: "application/pdf" }), {
          upsert: true, contentType: "application/pdf",
        });
      if (error) { toast({ title: "PDF 저장 실패", description: error.message, variant: "destructive" }); return; }
      setFrames(prev => ({ ...prev, [side]: { name: file.name, bytes: buf, preview: dataUrl, aspect } }));
      toast({ title: `${side === "front" ? "앞면" : "뒷면"} 프레임 업로드 완료` });
    } catch (e: any) {
      toast({ title: "PDF 처리 실패", description: e.message, variant: "destructive" });
    }
  };

  const rows: OrderRow[] = useMemo(() => {
    if (!ordersData) return [];
    return (ordersData as any[]).map(o => ({
      orderNo: o.external_order_id,
      receivedAt: fmtDate(o.created_at),
      dueDate: fmtDate(o.project_completed_at),
      recipient: o.recipient_name || "",
      quantity: o.quantity || 0,
    })).sort((a, b) => a.orderNo.localeCompare(b.orderNo));
  }, [ordersData]);

  if (detailOrderNo) {
    return (
      <DetailView
        orderNo={detailOrderNo}
        order={(ordersData as any[])?.find(o => o.external_order_id === detailOrderNo)}
        frames={frames}
        onBack={() => setDetailOrderNo(null)}
        userId={user?.id}
      />
    );
  }

  return (
    <div>
      <PageHeader title="NFC 카드 공장" description="카드 앞/뒷면 프레임 업로드 및 옵션 배치 · PDF 발주" />
      <div className="p-6 space-y-4">
        {/* Frame upload */}
        <Card>
          <CardHeader><CardTitle className="text-base">카드 PDF 프레임 업로드</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(["front", "back"] as const).map(side => (
              <div key={side} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">{side === "front" ? "카드 앞면 프레임" : "카드 뒷면 프레임"}</Label>
                  {frames[side] && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600">서버 저장됨</span>
                  )}
                </div>
                <div className="w-full h-48 border rounded bg-muted/30 overflow-hidden flex items-center justify-center">
                  {frames[side]?.preview
                    ? <img src={frames[side]!.preview} alt="" className="w-full h-full object-contain bg-white" />
                    : <span className="text-xs text-muted-foreground">업로드된 프레임 없음</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {frames[side]?.name || "파일 없음 (삭제/변경 전까지 서버에 유지됩니다)"}
                </div>
                <div className="flex gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 cursor-pointer text-xs px-3 py-2 border border-dashed rounded hover:bg-accent">
                    <Upload className="w-3 h-3" />
                    <span>{frames[side] ? "변경" : "PDF 업로드"}</span>
                    <input type="file" accept="application/pdf" className="hidden"
                      onChange={e => { const f = e.target.files?.[0] || null; e.currentTarget.value = ""; if (f) onUploadFrame(side, f); }} />
                  </label>
                  {frames[side] && (
                    <Button size="sm" variant="destructive" className="text-xs"
                      onClick={() => { if (confirm("서버에서 프레임 PDF를 삭제할까요?")) onUploadFrame(side, null); }}>
                      <X className="w-3 h-3 mr-1" />삭제
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Order list */}
        <Card>
          <CardHeader><CardTitle className="text-base">주문 목록</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>작업번호</TableHead>
                  <TableHead>주문접수일</TableHead>
                  <TableHead>납기일</TableHead>
                  <TableHead>트윈커</TableHead>
                  <TableHead className="text-right">작업수량</TableHead>
                  <TableHead className="text-right">상세보기</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">로딩 중...</TableCell></TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">주문 데이터가 없습니다</TableCell></TableRow>
                )}
                {rows.map(r => (
                  <TableRow key={r.orderNo}>
                    <TableCell className="font-mono">{r.orderNo}</TableCell>
                    <TableCell>{r.receivedAt}</TableCell>
                    <TableCell>{r.dueDate || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>{r.recipient}</TableCell>
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

// ============== DETAIL VIEW ==============
function DetailView({
  orderNo, order, frames, onBack, userId,
}: {
  orderNo: string;
  order: any;
  frames: { front: any; back: any };
  onBack: () => void;
  userId?: string;
}) {
  // Build cards array from order
  const cards: CardData[] = useMemo(() => {
    if (!order) return [];
    const items: any[] = Array.isArray(order.source_data?.items) ? order.source_data.items : [];
    const count = Math.max(items.length, order.quantity || 1);
    const uniqueNo = `${orderNo}-4`;
    return Array.from({ length: count }, (_, idx) => {
      const it = items[idx] || {};
      const sd = order.source_data || {};
      return {
        seq: idx + 1,
        orderNo,
        uniqueNo,
        uid: String(it.uid ?? it.UID ?? sd.uid ?? `${orderNo}-${idx + 1}`),
        cpValue: String(it.cp ?? it.cp_value ?? sd.cp_value ?? sd.cp ?? ""),
        editionNo: String(it.edition_no ?? it.edition ?? sd.edition_no ?? `${idx + 1}`),
        issuedNo: String(it.issued_no ?? sd.issued_no ?? `${idx + 1}`),
        mintedOn: String(it.minted_on ?? sd.minted_on ?? fmtDate(order.created_at)),
        grade: String(it.grade ?? sd.grade ?? order.grade ?? "COMMON").toUpperCase(),
        issuedByUrl: it.issued_by_url ?? sd.issued_by_url ?? null,
        twincodeSvgUrl: it.twincode_svg_url ?? it.svg_url ?? sd.twincode_svg_url ?? null,
        frontImageUrl: it.card_front_url ?? sd.card_front_url ?? null,
        backImageUrl: it.card_back_url ?? sd.card_back_url ?? null,
      };
    });
  }, [order, orderNo]);

  const [layoutFront, setLayoutFront] = useState<Record<OptionKey, OptionLayout>>(() => {
    const def: any = {};
    FRONT_KEYS.forEach(k => def[k] = { ...DEFAULT_LAYOUT[k] });
    return def;
  });
  const [layoutBack, setLayoutBack] = useState<Record<OptionKey, OptionLayout>>(() => {
    const def: any = {};
    BACK_KEYS.forEach(k => def[k] = { ...DEFAULT_LAYOUT[k] });
    return def;
  });
  const [workOrder, setWorkOrder] = useState({
    company: "TWINMETA",
    orderNo,
    orderDate: fmtDate(order?.created_at),
    deliveryDate: fmtDate(order?.project_completed_at),
    quantity: cards.length,
    recipient: "TWINMETA",
    phone: "18562757070",
    address: "山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load saved layout from user_ui_settings (per-order, fallback to global default)
  useEffect(() => {
    if (!userId) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const keys = [`${SETTINGS_KEY_PREFIX}-${orderNo}`, GLOBAL_LAYOUT_KEY];
      for (const key of keys) {
        const { data } = await supabase
          .from("user_ui_settings")
          .select("setting_value")
          .eq("user_id", userId)
          .eq("setting_key", key)
          .maybeSingle();
        if (cancelled) return;
        const v = data?.setting_value as any;
        if (v) {
          if (v.layoutFront) setLayoutFront(prev => ({ ...prev, ...v.layoutFront }));
          if (v.layoutBack)  setLayoutBack(prev => ({ ...prev, ...v.layoutBack }));
          if (v.workOrder)   setWorkOrder(prev => ({ ...prev, ...v.workOrder, orderNo }));
          break;
        }
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userId, orderNo]);

  const saveLayout = async () => {
    if (!userId) { toast({ title: "로그인 필요", variant: "destructive" }); return; }
    const payload = { layoutFront, layoutBack, workOrder } as any;
    const rows = [
      { user_id: userId, setting_key: `${SETTINGS_KEY_PREFIX}-${orderNo}`, setting_value: payload },
      { user_id: userId, setting_key: GLOBAL_LAYOUT_KEY, setting_value: payload },
    ];
    const { error } = await supabase
      .from("user_ui_settings")
      .upsert(rows as any, { onConflict: "user_id,setting_key" });
    if (error) {
      toast({ title: "저장 실패", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "저장 완료", description: "서버에 옵션 설정이 저장되었습니다" });
  };

  // ====== Build single-card PDF (2 pages: front + back) ======
  const buildCardPdfBytes = async (card: CardData): Promise<Uint8Array> => {
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    const cardWpt = CARD_W_MM * MM;
    const cardHpt = CARD_H_MM * MM;

    const drawSide = async (
      side: "front" | "back",
      layout: Record<OptionKey, OptionLayout>,
      keys: OptionKey[],
    ) => {
      const page = out.addPage([cardWpt, cardHpt]);
      // Draw frame background
      const frame = frames[side];
      if (frame?.bytes) {
        try {
          const [emb] = await out.embedPdf(frame.bytes);
          page.drawPage(emb, { x: 0, y: 0, width: cardWpt, height: cardHpt });
        } catch (e) { console.warn("frame embed failed", e); }
      }
      for (const key of keys) {
        const cfg = layout[key];
        if (!cfg?.enabled) continue;
        // pdf-lib origin = bottom-left. Our y is from top.
        const xMm = cfg.centerX ? (CARD_W_MM - cfg.w) / 2 : cfg.x;
        const yMm = cfg.centerY ? (CARD_H_MM - cfg.h) / 2 : cfg.y;
        const xPt = xMm * MM;
        const yPtBottom = (CARD_H_MM - yMm - cfg.h) * MM;

        const getText = (): string => {
          switch (key) {
            case "cpValue":   return card.cpValue ? `CP ${card.cpValue}` : "CP -";
            case "editionNo": return `EDITION No. ${card.editionNo}`;
            case "issuedNo":  return `ISSUED No. ${card.issuedNo}`;
            case "mintedOn":  return `Minted on ${card.mintedOn}`;
            case "grade":     return card.grade;
            default: return "";
          }
        };

        if (key === "twincode" && card.twincodeSvgUrl) {
          try {
            const png = await urlToPngBytes(card.twincodeSvgUrl);
            const emb = await out.embedPng(png);
            page.drawImage(emb, { x: xPt, y: yPtBottom, width: cfg.w * MM, height: cfg.h * MM });
          } catch (e) { console.warn("twincode draw fail", e); }
        } else if (key === "issuedBy" && card.issuedByUrl) {
          try {
            const png = await urlToPngBytes(card.issuedByUrl);
            const emb = await out.embedPng(png);
            page.drawImage(emb, { x: xPt, y: yPtBottom, width: cfg.w * MM, height: cfg.h * MM });
          } catch (e) { console.warn("issuedBy draw fail", e); }
        } else if (key === "dmBarcode") {
          try {
            const dmText = `${card.uniqueNo}|${card.uid}|${card.editionNo}`;
            const png = await dataMatrixPngBytes(dmText, 400);
            const emb = await out.embedPng(png);
            page.drawImage(emb, { x: xPt, y: yPtBottom, width: cfg.w * MM, height: cfg.h * MM });
          } catch (e) { console.warn("DM draw fail", e); }
        } else {
          const txt = getText();
          if (!txt) continue;
          const sizePt = Math.max(4, cfg.fontSize * MM);
          const textW = font.widthOfTextAtSize(txt, sizePt);
          const drawX = cfg.centerX ? (cardWpt - textW) / 2 : xPt;
          // baseline near top of box
          const drawY = (CARD_H_MM - yMm - cfg.fontSize) * MM;
          page.drawText(txt, { x: drawX, y: drawY, size: sizePt, font, color: rgb(0, 0, 0) });
        }
      }
    };

    await drawSide("front", layoutFront, FRONT_KEYS);
    await drawSide("back", layoutBack, BACK_KEYS);
    return await out.save();
  };

  const downloadOne = async (card: CardData) => {
    setBusy(true);
    try {
      const bytes = await buildCardPdfBytes(card);
      downloadBlob(bytes, `${card.uniqueNo}.pdf`);
    } catch (e: any) {
      toast({ title: "PDF 생성 실패", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const downloadAll = async () => {
    setBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Map<string, number>();
      for (const card of cards) {
        const bytes = await buildCardPdfBytes(card);
        const base = card.uniqueNo;
        const n = used.get(base) || 0;
        const fname = n === 0 ? `${base}.pdf` : `${base}(${n}).pdf`;
        used.set(base, n + 1);
        zip.file(fname, bytes);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${orderNo}_nfc-cards_${tsName()}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "ZIP 다운로드 완료", description: `${cards.length}개 카드` });
    } catch (e: any) {
      toast({ title: "ZIP 생성 실패", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title={`NFC 카드 공장 · ${orderNo}`} description="주문 상세 목록" />
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={onBack}>
              <ChevronLeft className="w-4 h-4 mr-1" /> 목록으로
            </Button>
            <div className="text-sm text-muted-foreground">
              작업번호 <span className="font-mono text-foreground">{orderNo}</span> · {cards.length}건
            </div>
          </CardContent>
        </Card>

        {/* Work order */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>작업지시서 설정</span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={saveLayout} disabled={!loaded}>
                  <Save className="w-4 h-4 mr-1" />서버에 저장
                </Button>
                <Button size="sm" variant="outline" onClick={() => printWorkOrder(workOrder)}>
                  <FileText className="w-4 h-4 mr-1" />작업지시서 출력
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TxtField label="발주업체명" v={workOrder.company} set={v => setWorkOrder(p => ({ ...p, company: v }))} />
            <TxtField label="작업번호" v={workOrder.orderNo} set={v => setWorkOrder(p => ({ ...p, orderNo: v }))} />
            <TxtField label="총수량" type="number" v={String(workOrder.quantity)} set={v => setWorkOrder(p => ({ ...p, quantity: Number(v) || 0 }))} />
            <TxtField label="발주일" type="date" v={workOrder.orderDate} set={v => setWorkOrder(p => ({ ...p, orderDate: v }))} />
            <TxtField label="납품일" type="date" v={workOrder.deliveryDate} set={v => setWorkOrder(p => ({ ...p, deliveryDate: v }))} />
            <TxtField label="받을사람" v={workOrder.recipient} set={v => setWorkOrder(p => ({ ...p, recipient: v }))} />
            <TxtField label="전화번호" v={workOrder.phone} set={v => setWorkOrder(p => ({ ...p, phone: v }))} />
            <div className="md:col-span-2">
              <TxtField label="주소" v={workOrder.address} set={v => setWorkOrder(p => ({ ...p, address: v }))} />
            </div>
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">발주특이사항</Label>
              <Textarea value={workOrder.notes} onChange={e => setWorkOrder(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </CardContent>
        </Card>

        {/* Layout designer */}
        <Tabs defaultValue="front">
          <TabsList>
            <TabsTrigger value="front">카드 앞면</TabsTrigger>
            <TabsTrigger value="back">카드 뒷면</TabsTrigger>
          </TabsList>

          <TabsContent value="front" className="pt-3">
            <CardSideEditor
              side="front"
              frame={frames.front}
              cardPreview={cards[0]}
              layout={layoutFront}
              setLayout={setLayoutFront}
              keys={FRONT_KEYS}
            />
          </TabsContent>
          <TabsContent value="back" className="pt-3">
            <CardSideEditor
              side="back"
              frame={frames.back}
              cardPreview={cards[0]}
              layout={layoutBack}
              setLayout={setLayoutBack}
              keys={BACK_KEYS}
            />
          </TabsContent>
        </Tabs>

        {/* Download bar */}
        <Card>
          <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-muted-foreground">
              파일명: <span className="font-mono">{orderNo}-4.pdf</span> · 중복시 (1),(2) 자동 부여
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={downloadAll} disabled={busy || cards.length === 0}>
                {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                전체 PDF (ZIP)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">순번</TableHead>
                  <TableHead>주문번호</TableHead>
                  <TableHead>UID</TableHead>
                  <TableHead>카드고유번호</TableHead>
                  <TableHead>앞면</TableHead>
                  <TableHead>뒷면</TableHead>
                  <TableHead>CP값</TableHead>
                  <TableHead>EDITION</TableHead>
                  <TableHead>ISSUED No.</TableHead>
                  <TableHead>Minted on</TableHead>
                  <TableHead>등급</TableHead>
                  <TableHead>ISSUED BY</TableHead>
                  <TableHead>트윈코드</TableHead>
                  <TableHead>DM 바코드</TableHead>
                  <TableHead className="text-right">다운로드</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.length === 0 && (
                  <TableRow><TableCell colSpan={15} className="text-center py-8 text-muted-foreground">—</TableCell></TableRow>
                )}
                {cards.map(c => (
                  <TableRow key={`${c.uniqueNo}-${c.seq}`}>
                    <TableCell className="tabular-nums">{c.seq}</TableCell>
                    <TableCell className="font-mono text-xs">{c.orderNo}</TableCell>
                    <TableCell className="font-mono text-xs">{c.uid}</TableCell>
                    <TableCell className="font-mono text-xs">{c.uniqueNo}</TableCell>
                    <TableCell>
                      {c.frontImageUrl
                        ? <a href={c.frontImageUrl} target="_blank" rel="noopener noreferrer"><img src={c.frontImageUrl} alt="" className="w-10 h-6 object-cover border rounded" /></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      {c.backImageUrl
                        ? <a href={c.backImageUrl} target="_blank" rel="noopener noreferrer"><img src={c.backImageUrl} alt="" className="w-10 h-6 object-cover border rounded" /></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="text-xs">{c.cpValue || "-"}</TableCell>
                    <TableCell className="text-xs">{c.editionNo}</TableCell>
                    <TableCell className="text-xs">{c.issuedNo}</TableCell>
                    <TableCell className="text-xs">{c.mintedOn}</TableCell>
                    <TableCell><Badge variant="outline">{c.grade}</Badge></TableCell>
                    <TableCell>
                      {c.issuedByUrl
                        ? <a href={c.issuedByUrl} target="_blank" rel="noopener noreferrer"><img src={c.issuedByUrl} alt="" className="w-10 h-6 object-contain border rounded bg-white" /></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      {c.twincodeSvgUrl
                        ? <a href={c.twincodeSvgUrl} target="_blank" rel="noopener noreferrer"><img src={c.twincodeSvgUrl} alt="" className="w-8 h-8 object-contain border rounded bg-white" /></a>
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell><DmThumb text={`${c.uniqueNo}|${c.uid}|${c.editionNo}`} /></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => downloadOne(c)} disabled={busy}>
                        <Download className="w-4 h-4" />
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

// ============== Card side editor (preview + per-option controls) ==============
function CardSideEditor({
  side, frame, cardPreview, layout, setLayout, keys,
}: {
  side: "front" | "back";
  frame: any;
  cardPreview?: CardData;
  layout: Record<OptionKey, OptionLayout>;
  setLayout: React.Dispatch<React.SetStateAction<Record<OptionKey, OptionLayout>>>;
  keys: OptionKey[];
}) {
  // Preview area: render card at scale (px per mm)
  const PX_PER_MM = 5;
  const previewW = CARD_W_MM * PX_PER_MM;
  const previewH = CARD_H_MM * PX_PER_MM;

  const update = (key: OptionKey, patch: Partial<OptionLayout>) => {
    setLayout(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const [dmPreview, setDmPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!keys.includes("dmBarcode") || !cardPreview) return;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await dataMatrixPngBytes(`${cardPreview.uniqueNo}|${cardPreview.uid}|${cardPreview.editionNo}`, 200);
        if (cancelled) return;
        const blob = new Blob([bytes as BlobPart], { type: "image/png" });
        setDmPreview(URL.createObjectURL(blob));
      } catch {}
    })();
    return () => { cancelled = true; if (dmPreview) URL.revokeObjectURL(dmPreview); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPreview?.uniqueNo, keys.join(",")]);

  const renderOptionPreview = (key: OptionKey) => {
    if (!cardPreview) return null;
    switch (key) {
      case "cpValue":   return <span className="leading-none">CP {cardPreview.cpValue || "-"}</span>;
      case "editionNo": return <span className="leading-none">EDITION No. {cardPreview.editionNo}</span>;
      case "issuedNo":  return <span className="leading-none">ISSUED No. {cardPreview.issuedNo}</span>;
      case "mintedOn":  return <span className="leading-none">Minted on {cardPreview.mintedOn}</span>;
      case "grade":     return <span className="leading-none font-bold">{cardPreview.grade}</span>;
      case "issuedBy":  return cardPreview.issuedByUrl
        ? <img src={cardPreview.issuedByUrl} alt="" className="w-full h-full object-contain" />
        : <span className="text-[8px] text-muted-foreground">ISSUED BY</span>;
      case "twincode":  return cardPreview.twincodeSvgUrl
        ? <img src={cardPreview.twincodeSvgUrl} alt="" className="w-full h-full object-contain bg-white" />
        : <span className="text-[8px] text-muted-foreground">TWIN</span>;
      case "dmBarcode": return dmPreview
        ? <img src={dmPreview} alt="" className="w-full h-full object-contain" />
        : <span className="text-[8px] text-muted-foreground">DM</span>;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{side === "front" ? "카드 앞면" : "카드 뒷면"} 옵션 배치</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preview */}
        <div className="flex justify-center">
          <div
            className="relative border-2 rounded-md overflow-hidden shadow-md"
            style={{ width: previewW, height: previewH, background: frame?.preview ? `url(${frame.preview}) center/contain no-repeat #fff` : "#fff" }}
          >
            {keys.map(key => {
              const cfg = layout[key];
              if (!cfg?.enabled) return null;
              const xMm = cfg.centerX ? (CARD_W_MM - cfg.w) / 2 : cfg.x;
              const yMm = cfg.centerY ? (CARD_H_MM - cfg.h) / 2 : cfg.y;
              const fontPx = (cfg.fontSize || 3) * PX_PER_MM;
              const isImage = key === "twincode" || key === "issuedBy" || key === "dmBarcode";
              return (
                <div
                  key={key}
                  className="absolute border border-primary/60 bg-primary/5 flex items-center justify-center text-foreground overflow-hidden"
                  style={{
                    left: xMm * PX_PER_MM,
                    top: yMm * PX_PER_MM,
                    width: cfg.w * PX_PER_MM,
                    height: cfg.h * PX_PER_MM,
                    fontSize: isImage ? undefined : fontPx,
                  }}
                  title={OPTION_LABELS[key]}
                >
                  {renderOptionPreview(key)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Per-option controls */}
        <div className="space-y-2">
          {keys.map(key => {
            const cfg = layout[key];
            const isImage = key === "twincode" || key === "issuedBy" || key === "dmBarcode";
            return (
              <div key={key} className="border rounded-md p-3 grid grid-cols-2 md:grid-cols-8 gap-2 items-end">
                <div className="md:col-span-2 flex items-center gap-2">
                  <Checkbox checked={cfg.enabled} onCheckedChange={v => update(key, { enabled: !!v })} />
                  <Label className="text-sm font-medium">{OPTION_LABELS[key]}</Label>
                </div>
                <Mini label="X(mm)" v={cfg.x} set={v => update(key, { x: v })} disabled={cfg.centerX} />
                <Mini label="Y(mm)" v={cfg.y} set={v => update(key, { y: v })} disabled={cfg.centerY} />
                <Mini label="너비(mm)" v={cfg.w} set={v => update(key, { w: v })} />
                <Mini label={isImage ? "높이(mm)" : "박스높이(mm)"} v={cfg.h} set={v => update(key, { h: v })} />
                {!isImage && (
                  <Mini label="글자(mm)" v={cfg.fontSize} set={v => update(key, { fontSize: v })} step={0.1} />
                )}
                <div className="flex items-center gap-1">
                  <Checkbox checked={cfg.centerX} onCheckedChange={v => update(key, { centerX: !!v })} />
                  <Label className="text-xs">가로 중앙</Label>
                </div>
                <div className="flex items-center gap-1">
                  <Checkbox checked={cfg.centerY} onCheckedChange={v => update(key, { centerY: !!v })} />
                  <Label className="text-xs">세로 중앙</Label>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Mini({ label, v, set, step, disabled }: { label: string; v: number; set: (v: number) => void; step?: number; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input type="number" step={step ?? 0.5} value={v} disabled={disabled}
        onChange={e => set(Number(e.target.value) || 0)} className="h-8 text-xs" />
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

function DmThumb({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bytes = await dataMatrixPngBytes(text, 120);
        if (cancelled) return;
        const blob = new Blob([bytes as BlobPart], { type: "image/png" });
        setSrc(URL.createObjectURL(blob));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [text]);
  return src
    ? <img src={src} alt="dm" className="w-8 h-8 border rounded bg-white" />
    : <div className="w-8 h-8 border rounded bg-muted" />;
}

// ===== Work order print (Chinese) =====
function printWorkOrder(wo: { company: string; orderNo: string; orderDate: string; deliveryDate: string; quantity: number; recipient: string; phone: string; address: string; notes: string; }) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const today = new Date().toISOString().slice(0, 10);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>作业指示书 - ${esc(wo.orderNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif; color:#111; margin:0; }
  h1 { font-size: 22pt; text-align:center; margin: 0 0 4mm; letter-spacing: 8px; border-bottom: 2px solid #111; padding-bottom: 4mm; }
  .meta { display:flex; justify-content:space-between; font-size: 9pt; color:#555; margin-bottom: 6mm; }
  table { width:100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 1px solid #333; padding: 2.5mm 3mm; vertical-align: middle; }
  th { background:#f2f2f2; font-weight:600; width: 22%; text-align:left; }
  .notes { min-height: 22mm; white-space: pre-wrap; }
  h2 { font-size: 12pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  .no-print { position:fixed; top:8px; right:8px; }
  @media print { .no-print { display:none; } }
</style></head>
<body>
  <div class="no-print"><button onclick="window.print()">打印 / 保存PDF</button></div>
  <h1>NFC 卡 · 作 业 指 示 书</h1>
  <div class="meta"><span>发包方:${esc(wo.company)}</span><span>打印日期:${today}</span></div>
  <table>
    <tr><th>发包公司</th><td>${esc(wo.company)}</td><th>作业编号</th><td>${esc(wo.orderNo)}</td></tr>
    <tr><th>下单日期</th><td>${esc(wo.orderDate)}</td><th>交货日期</th><td>${esc(wo.deliveryDate)}</td></tr>
    <tr><th>总数量</th><td>${esc(wo.quantity)}</td><th>收件人</th><td>${esc(wo.recipient)}</td></tr>
    <tr><th>联系电话</th><td>${esc(wo.phone)}</td><th>收货地址</th><td>${esc(wo.address)}</td></tr>
  </table>
  <h2>订单特殊事项</h2>
  <table><tr><td class="notes">${esc(wo.notes) || "&nbsp;"}</td></tr></table>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body></html>`;
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { toast({ title: "팝업 차단됨", variant: "destructive" }); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
