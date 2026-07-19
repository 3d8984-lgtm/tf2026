import { forwardRef, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useOrders } from "@/hooks/useDbData";
import {
  ArrowLeft, Eye, FileText, FileCheck2, Download, CheckCircle2, Circle, Save,
} from "lucide-react";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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

const WO_STORAGE_PREFIX = "tshirt_work_order_v1_";
const WO_DEFAULTS_KEY = "tshirt_work_order_defaults_v1";
const DEFAULT_FIELDS = ["supplier", "receiverName", "receiverPhone", "receiverAddress", "notes"] as const;
function loadWoDefaults(): Partial<Record<(typeof DEFAULT_FIELDS)[number], string>> {
  try {
    const raw = localStorage.getItem(WO_DEFAULTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

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

  // 작업지시서 설정 (localStorage 저장/복원)
  const storageKey = WO_STORAGE_PREFIX + orderNo;
  const defaultWO = {
    orderNo,
    twinker: order?.recipient_name ?? "",
    dueDate: fmtDate(order?.project_completed_at),
    supplier: "",
    orderDate: new Date().toISOString().slice(0, 10),
    receiverName: order?.recipient_name ?? "",
    receiverPhone: order?.recipient_phone ?? order?.source_data?.recipient_phone ?? "",
    receiverAddress: order?.recipient_address ?? order?.source_data?.recipient_address ?? "",
    notes: "",
  };
  const [workOrder, setWorkOrder] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return { ...defaultWO, ...JSON.parse(raw) };
    } catch {}
    return defaultWO;
  });

  const saveWorkOrder = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(workOrder));
      toast({ title: "작업지시서 저장 완료" });
    } catch (e: any) {
      toast({ title: "저장 실패", description: e?.message, variant: "destructive" });
    }
  };

  // A4 미리보기 / PDF
  const previewRef = useRef<HTMLDivElement>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const buildPdfBlob = async (): Promise<Blob> => {
    const node = previewRef.current!;
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    return pdf.output("blob");
  };

  // 발주진행 상태
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const stepLabels = ["작업지시서 확인", "작업파일 확인", "발주(ZIP 다운로드)"];

  const confirmWorkOrder = () => {
    setPdfOpen(true);
  };
  const acceptWorkOrder = () => {
    setStep(s => (s < 1 ? 1 : s));
    setPdfOpen(false);
    toast({ title: "작업지시서 확인 완료" });
  };

  const downloadWorkOrderPdf = async () => {
    try {
      setPdfLoading(true);
      await new Promise(r => setTimeout(r, 50));
      const blob = await buildPdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `work_order_${orderNo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "PDF 생성 실패", description: e?.message, variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  const [filesPreviewOpen, setFilesPreviewOpen] = useState(false);
  const openFilesPreview = () => {
    if (step < 1) { toast({ title: "먼저 작업지시서를 확인해주세요", variant: "destructive" }); return; }
    setFilesPreviewOpen(true);
  };
  const confirmFiles = () => {
    setStep(s => (s < 2 ? 2 : s));
    setFilesPreviewOpen(false);
    toast({ title: "작업파일 확인 완료" });
  };

  const downloadTshirtXlsx = () => {
    const wsData = [
      ["Type", "Color", "Size", "Quantity"],
      ...agg.map(a => [a.type, a.color, a.size, a.qty]),
      ["", "", "Total", totalQty],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "T-Shirt Order");
    XLSX.writeFile(wb, `tshirt_order_${orderNo}.xlsx`);
  };

  const downloadZip = async () => {
    if (step < 2) { toast({ title: "먼저 작업파일을 확인해주세요", variant: "destructive" }); return; }
    const zip = new JSZip();

    // 작업지시서 PDF (A4)
    try {
      const blob = await buildPdfBlob();
      zip.file("work_order.pdf", blob);
    } catch (e) {
      console.error("PDF build for ZIP failed", e);
    }

    // 티셔츠 발주 내역 Excel (영어 헤더)
    const wsData = [
      ["Type", "Color", "Size", "Quantity"],
      ...agg.map(a => [a.type, a.color, a.size, a.qty]),
      ["", "", "Total", totalQty],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "T-Shirt Order");
    const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    zip.file("tshirt_order.xlsx", xlsxBuf);

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
              <Button size="sm" variant={step >= 2 ? "outline" : "default"} onClick={openFilesPreview} disabled={step < 1}>
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
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>작업지시서 설정</span>
              <Button size="sm" onClick={saveWorkOrder}>
                <Save className="w-4 h-4 mr-1" /> 저장
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="작업번호" value={workOrder.orderNo} onChange={v => setWorkOrder(p => ({ ...p, orderNo: v }))} />
              <Field label="트윈커" value={workOrder.twinker} onChange={v => setWorkOrder(p => ({ ...p, twinker: v }))} />
              <Field label="납기일" value={workOrder.dueDate} onChange={v => setWorkOrder(p => ({ ...p, dueDate: v }))} />
              <Field label="발주업체명" value={workOrder.supplier} onChange={v => setWorkOrder(p => ({ ...p, supplier: v }))} />
              <div className="space-y-1">
                <Label className="text-xs">총수량</Label>
                <Input value={String(totalQty)} readOnly className="bg-muted/40" />
              </div>
              <Field label="발주일" value={workOrder.orderDate} onChange={v => setWorkOrder(p => ({ ...p, orderDate: v }))} />
              <Field label="받을사람" value={workOrder.receiverName} onChange={v => setWorkOrder(p => ({ ...p, receiverName: v }))} />
              <Field label="전화번호" value={workOrder.receiverPhone} onChange={v => setWorkOrder(p => ({ ...p, receiverPhone: v }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">주소</Label>
              <Input value={workOrder.receiverAddress} onChange={e => setWorkOrder(p => ({ ...p, receiverAddress: e.target.value }))} />
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

      {/* 오프스크린 렌더링: PDF 생성용 (항상 마운트) */}
      <div style={{ position: "fixed", left: "-10000px", top: 0, pointerEvents: "none", opacity: 0 }} aria-hidden>
        <WorkOrderSheet ref={previewRef} workOrder={workOrder} agg={agg} totalQty={totalQty} />
      </div>

      {/* 작업지시서 A4 미리보기 다이얼로그 */}
      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-5xl w-[95vw] h-[90vh] flex flex-col bg-muted/30">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-8">
              <span>작업지시서 A4 미리보기</span>
              <Button size="sm" variant="outline" onClick={downloadWorkOrderPdf} disabled={pdfLoading}>
                <Download className="w-4 h-4 mr-1" /> {pdfLoading ? "PDF 생성 중..." : "PDF 다운로드"}
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto flex justify-center py-4">
            <WorkOrderSheet workOrder={workOrder} agg={agg} totalQty={totalQty} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setPdfOpen(false)}>취소</Button>
            <Button size="sm" onClick={acceptWorkOrder}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 작업파일(Excel) 미리보기 다이얼로그 */}
      <Dialog open={filesPreviewOpen} onOpenChange={setFilesPreviewOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-3xl w-[95vw] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-8">
              <span>작업파일 미리보기 · tshirt_order.xlsx</span>
              <Button size="sm" variant="outline" onClick={downloadTshirtXlsx}>
                <Download className="w-4 h-4 mr-1" /> Excel 다운로드
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="border px-3 py-2 text-left">Type</th>
                  <th className="border px-3 py-2 text-left">Color</th>
                  <th className="border px-3 py-2 text-left">Size</th>
                  <th className="border px-3 py-2 text-right">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {agg.map((a, i) => (
                  <tr key={i}>
                    <td className="border px-3 py-2">{a.type}</td>
                    <td className="border px-3 py-2">{a.color}</td>
                    <td className="border px-3 py-2">{a.size}</td>
                    <td className="border px-3 py-2 text-right tabular-nums">{a.qty}</td>
                  </tr>
                ))}
                <tr className="font-semibold bg-muted/40">
                  <td className="border px-3 py-2" colSpan={3}>Total</td>
                  <td className="border px-3 py-2 text-right tabular-nums">{totalQty}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setFilesPreviewOpen(false)}>취소</Button>
            <Button size="sm" onClick={confirmFiles}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> 확인
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const cellTh: React.CSSProperties = { border: "1px solid #111", padding: "6px 8px", textAlign: "left", fontWeight: 700 };
const cellTd: React.CSSProperties = { border: "1px solid #111", padding: "6px 8px" };

function RowKV({ k, v, k2, v2 }: { k: string; v: string; k2: string; v2: string }) {
  const th: React.CSSProperties = { width: "18%", background: "#f3f4f6", padding: "6px 8px", border: "1px solid #d1d5db", textAlign: "left", fontWeight: 600 };
  const td: React.CSSProperties = { width: "32%", padding: "6px 8px", border: "1px solid #d1d5db" };
  return (
    <tr>
      <th style={th}>{k}</th><td style={td}>{v}</td>
      <th style={th}>{k2}</th><td style={td}>{v2}</td>
    </tr>
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

const WorkOrderSheet = forwardRef<HTMLDivElement, { workOrder: any; agg: AggRow[]; totalQty: number }>(
  ({ workOrder, agg, totalQty }, ref) => (
    <div
      ref={ref}
      style={{
        width: "210mm",
        minHeight: "297mm",
        padding: "16mm",
        background: "#ffffff",
        color: "#111827",
        fontFamily: "'Noto Sans KR', 'Malgun Gothic', sans-serif",
        fontSize: "12px",
        boxSizing: "border-box",
        boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ textAlign: "center", fontSize: "20px", fontWeight: 700, marginBottom: "12px" }}>
        T恤生产作业指示书
      </div>
      <div style={{ borderTop: "2px solid #111", borderBottom: "1px solid #111", padding: "8px 0", marginBottom: "12px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <RowKV k="作业编号" v={workOrder.orderNo} k2="下单日期" v2={workOrder.orderDate} />
            <RowKV k="下单人" v={workOrder.twinker} k2="交货日期" v2={workOrder.dueDate} />
            <RowKV k="供应商名称" v={workOrder.supplier} k2="总数量" v2={String(totalQty)} />
            <RowKV k="收件人" v={workOrder.receiverName} k2="联系电话" v2={workOrder.receiverPhone} />
          </tbody>
        </table>
        <div style={{ marginTop: "6px", display: "flex", gap: "8px" }}>
          <div style={{ width: "80px", fontWeight: 600 }}>收件地址</div>
          <div style={{ flex: 1 }}>{workOrder.receiverAddress}</div>
        </div>
      </div>

      <div style={{ fontWeight: 700, margin: "8px 0" }}>T恤订购明细</div>
      <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #111" }}>
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            <th style={cellTh}>款式</th>
            <th style={cellTh}>颜色</th>
            <th style={cellTh}>尺码</th>
            <th style={{ ...cellTh, textAlign: "right" }}>数量</th>
          </tr>
        </thead>
        <tbody>
          {agg.map((a, i) => (
            <tr key={i}>
              <td style={cellTd}>{a.type}</td>
              <td style={cellTd}>{a.color}</td>
              <td style={cellTd}>{a.size}</td>
              <td style={{ ...cellTd, textAlign: "right" }}>{a.qty}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cellTd, fontWeight: 700 }} colSpan={3}>合计</td>
            <td style={{ ...cellTd, textAlign: "right", fontWeight: 700 }}>{totalQty}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: "12px" }}>
        <div style={{ fontWeight: 700, marginBottom: "4px" }}>备注</div>
        <div style={{ minHeight: "40px", border: "1px solid #ccc", padding: "6px", whiteSpace: "pre-wrap" }}>
          {workOrder.notes}
        </div>
      </div>
    </div>
  )
);
WorkOrderSheet.displayName = "WorkOrderSheet";
