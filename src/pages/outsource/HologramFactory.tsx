import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, Eye } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import QRCode from "qrcode";

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
      const uniqueNo = `${detailOrder.external_order_id}-3-${editionNo}`;
      const qrValue = (it.hologram_qr as string) || uniqueNo;
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
      <div className="p-6">
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
