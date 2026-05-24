import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
(pdfjsLib as any).GlobalWorkerOptions.workerPort = new PdfWorker();
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, Eye, Upload, FileText, X, Loader2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
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
    return (
      <div>
        <PageHeader title={t("menu.outHologram")} description="주문 상세 목록" />
        <div className="p-6">
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
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">순번</TableHead>
                    <TableHead>주문번호</TableHead>
                    <TableHead>스티커 고유번호</TableHead>
                    <TableHead>에디션 넘버</TableHead>
                    <TableHead>등급</TableHead>
                    <TableHead>큐알코드</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailItems.map(it => (
                    <TableRow key={it.uniqueNo}>
                      <TableCell>{it.seq}</TableCell>
                      <TableCell className="font-mono">{it.orderNo}</TableCell>
                      <TableCell className="font-mono">{it.uniqueNo}</TableCell>
                      <TableCell>#{String(it.editionNo).padStart(4, "0")}</TableCell>
                      <TableCell><Badge variant="outline">{it.grade}</Badge></TableCell>
                      <TableCell><QrThumb value={it.qrValue} /></TableCell>
                    </TableRow>
                  ))}
                  {detailItems.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">—</TableCell></TableRow>
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
                {pdfUrl ? (
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
                {pdfUrl && (
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
                  <Upload className="w-4 h-4 mr-1" /> {pdfUrl ? "변경" : "파일 선택"}
                </Button>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">미리보기</div>
              {pdfUrl ? (
                <iframe
                  src={pdfUrl}
                  title="PDF 미리보기"
                  className="w-full h-[600px] rounded-md border border-border bg-background"
                />
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
