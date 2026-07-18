import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useOrders } from "@/hooks/useDbData";
import {
  ArrowLeft, Eye, FileText, FileCheck2, Download, CheckCircle2, Circle,
} from "lucide-react";
import JSZip from "jszip";

type OrderRow = {
  id: string;
  orderNo: string;
  receivedAt: string;
  dueDate: string;
  recipient: string;
  quantity: number;
};

function fmtDate(v?: string | null) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function TshirtOrderFactory() {
  const { data: ordersData, isLoading } = useOrders();
  const [detailOrderNo, setDetailOrderNo] = useState<string | null>(null);

  const rows: OrderRow[] = useMemo(() => {
    if (!ordersData) return [];
    return (ordersData as any[]).map(o => ({
      id: o.id,
      orderNo: o.external_order_id,
      receivedAt: fmtDate(o.created_at),
      dueDate: fmtDate(o.project_completed_at),
      recipient: o.recipient_name || "",
      quantity: o.quantity || 0,
    })).sort((a, b) => a.orderNo.localeCompare(b.orderNo));
  }, [ordersData]);

  if (detailOrderNo) {
    const order = (ordersData as any[])?.find(o => o.external_order_id === detailOrderNo);
    return (
      <DetailView
        order={order}
        onBack={() => setDetailOrderNo(null)}
      />
    );
  }

  return (
    <div>
      <PageHeader title="주문 티셔츠 공장" description="주문 데이터로 취합된 티셔츠 발주 관리" />
      <div className="p-6 space-y-4">
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
                  <TableHead className="text-right">주문수량</TableHead>
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

type AggRow = { type: string; color: string; size: string; qty: number };

function DetailView({ order, onBack }: { order: any; onBack: () => void }) {
  const orderNo = order?.external_order_id ?? "";
  const items: any[] = Array.isArray(order?.source_data?.items) ? order.source_data.items : [];

  const agg: AggRow[] = useMemo(() => {
    const map = new Map<string, AggRow>();
    for (const it of items) {
      const type = String(it.tshirt_type ?? "").trim() || "-";
      const color = String(it.tshirt_color ?? "").trim() || "-";
      const size = String(it.tshirt_size ?? "").trim() || "-";
      const key = `${type}||${color}||${size}`;
      const cur = map.get(key);
      if (cur) cur.qty += 1;
      else map.set(key, { type, color, size, qty: 1 });
    }
    return Array.from(map.values()).sort((a, b) =>
      a.type.localeCompare(b.type) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size)
    );
  }, [items]);

  const totalQty = agg.reduce((s, a) => s + a.qty, 0);

  // 작업지시서 설정
  const [workOrder, setWorkOrder] = useState({
    orderNo,
    twinker: order?.recipient_name ?? "",
    dueDate: fmtDate(order?.project_completed_at),
    supplier: "",
    notes: "",
  });

  // 발주진행 상태
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const stepLabels = ["작업지시서 확인", "작업파일 확인", "발주(ZIP 다운로드)"];

  const confirmWorkOrder = () => {
    setStep(s => (s < 1 ? 1 : s));
    toast({ title: "작업지시서 확인 완료" });
  };
  const confirmFiles = () => {
    if (step < 1) { toast({ title: "먼저 작업지시서를 확인해주세요", variant: "destructive" }); return; }
    setStep(s => (s < 2 ? 2 : s));
    toast({ title: "작업파일 확인 완료" });
  };
  const downloadZip = async () => {
    if (step < 2) { toast({ title: "먼저 작업파일을 확인해주세요", variant: "destructive" }); return; }
    const zip = new JSZip();
    // 작업지시서.txt
    const wo = [
      `작업번호: ${workOrder.orderNo}`,
      `트윈커: ${workOrder.twinker}`,
      `납기일: ${workOrder.dueDate}`,
      `공급업체: ${workOrder.supplier}`,
      `총 수량: ${totalQty}`,
      "",
      "[티셔츠 발주 내역]",
      "종류\t색상\t사이즈\t수량",
      ...agg.map(a => `${a.type}\t${a.color}\t${a.size}\t${a.qty}`),
      "",
      "비고:",
      workOrder.notes,
    ].join("\n");
    zip.file("작업지시서.txt", wo);
    // 발주내역.csv
    const csv = ["종류,색상,사이즈,수량", ...agg.map(a => `${a.type},${a.color},${a.size},${a.qty}`)].join("\n");
    zip.file("발주내역.csv", csv);

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tshirt_order_${orderNo}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setStep(3);
    toast({ title: "발주 ZIP 다운로드 완료" });
  };

  return (
    <div>
      <PageHeader title={`주문 상세 · ${orderNo}`} description="주문 티셔츠 발주 진행">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 목록
        </Button>
      </PageHeader>
      <div className="p-6 space-y-4">
        {/* 발주진행 박스 */}
        <Card>
          <CardHeader><CardTitle className="text-base">발주 진행</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 flex-wrap">
              {stepLabels.map((label, i) => {
                const done = step > i;
                const active = step === i;
                return (
                  <div key={label} className="flex items-center gap-2">
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                      done ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600"
                        : active ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-muted/40 border-border text-muted-foreground"
                    }`}>
                      {done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                      <span className="text-sm font-medium">{i + 1}. {label}</span>
                    </div>
                    {i < stepLabels.length - 1 && <span className="text-muted-foreground">→</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              <Button size="sm" variant={step >= 1 ? "outline" : "default"} onClick={confirmWorkOrder}>
                <FileText className="w-4 h-4 mr-1" /> 작업지시서 확인
              </Button>
              <Button size="sm" variant={step >= 2 ? "outline" : "default"} onClick={confirmFiles} disabled={step < 1}>
                <FileCheck2 className="w-4 h-4 mr-1" /> 작업파일 확인
              </Button>
              <Button size="sm" onClick={downloadZip} disabled={step < 2}>
                <Download className="w-4 h-4 mr-1" /> 발주(ZIP 다운로드)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 작업지시서 설정 */}
        <Card>
          <CardHeader><CardTitle className="text-base">작업지시서 설정</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="작업번호" value={workOrder.orderNo} onChange={v => setWorkOrder(p => ({ ...p, orderNo: v }))} />
              <Field label="트윈커" value={workOrder.twinker} onChange={v => setWorkOrder(p => ({ ...p, twinker: v }))} />
              <Field label="납기일" value={workOrder.dueDate} onChange={v => setWorkOrder(p => ({ ...p, dueDate: v }))} />
              <Field label="공급업체" value={workOrder.supplier} onChange={v => setWorkOrder(p => ({ ...p, supplier: v }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">비고</Label>
              <Textarea rows={3} value={workOrder.notes} onChange={e => setWorkOrder(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </CardContent>
        </Card>

        {/* 티셔츠 발주 내역 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>티셔츠 발주 내역</span>
              <Badge variant="secondary">총 {totalQty}개</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agg.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">주문 항목이 없습니다</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>티셔츠 종류</TableHead>
                    <TableHead>색상</TableHead>
                    <TableHead>사이즈</TableHead>
                    <TableHead className="text-right">수량</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agg.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell>{a.type}</TableCell>
                      <TableCell>{a.color}</TableCell>
                      <TableCell>{a.size}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{a.qty}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
