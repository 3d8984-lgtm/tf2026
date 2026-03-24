import { useState, useRef, useEffect, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ScanLine, CheckCircle2, XCircle, Clock, AlertTriangle,
  Image, Sticker, QrCode, Hash, Shirt, RotateCcw, Loader2,
  ChevronRight, Package, ChevronLeft, List
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";

type StepStatus = "waiting" | "scanning" | "pass" | "fail";

interface WorkItem {
  seq: number;
  color: string;
  size: string;
  siliconQR: string;
  designQR: string;
  hologramQR: string;
  status: "pending" | "done" | "fail";
}

interface OrderData {
  id: string;
  orderNo: string;
  twinker: string;
  product: string;
  design: string;
  dueDate: string;
  items: WorkItem[];
}

// Mock: each order contains multiple work items with individual color/size/QR
const mockOrders: OrderData[] = [
  {
    id: "WO-001", orderNo: "ORD-2024-1582", product: "BT-2024-A", design: "DSN-047", priority: "high", dueDate: "2024-03-25",
    items: [
      { seq: 1, color: "Black", size: "L", siliconQR: "SQR-00482", designQR: "DQR-00482", hologramQR: "HQR-A0931", status: "done" },
      { seq: 2, color: "Black", size: "L", siliconQR: "SQR-00481", designQR: "DQR-00481", hologramQR: "HQR-A0930", status: "done" },
      { seq: 3, color: "Navy", size: "XL", siliconQR: "SQR-00480", designQR: "DQR-00479", hologramQR: "HQR-A0929", status: "pending" },
      { seq: 4, color: "Black", size: "L", siliconQR: "SQR-00483", designQR: "DQR-00483", hologramQR: "HQR-A0932", status: "pending" },
      { seq: 5, color: "Navy", size: "M", siliconQR: "SQR-00484", designQR: "DQR-00484", hologramQR: "HQR-A0933", status: "pending" },
    ],
  },
  {
    id: "WO-002", orderNo: "20260324-2", twinker: "박서연", product: "BT-2024-B", design: "DSN-012", dueDate: "2024-03-26",
    items: [
      { seq: 1, color: "White", size: "M", siliconQR: "SQR-00479", designQR: "DQR-00490", hologramQR: "HQR-A0928", status: "done" },
      { seq: 2, color: "White", size: "S", siliconQR: "SQR-00491", designQR: "DQR-00491", hologramQR: "HQR-A0934", status: "done" },
      { seq: 3, color: "White", size: "M", siliconQR: "SQR-00492", designQR: "DQR-00492", hologramQR: "HQR-A0935", status: "done" },
    ],
  },
  {
    id: "WO-003", orderNo: "20260324-3", twinker: "이하윤", product: "BT-2024-C", design: "DSN-091", dueDate: "2024-03-27",
    items: [
      { seq: 1, color: "Gray", size: "M", siliconQR: "SQR-00500", designQR: "DQR-00500", hologramQR: "HQR-A0940", status: "pending" },
      { seq: 2, color: "Gray", size: "L", siliconQR: "SQR-00501", designQR: "DQR-00501", hologramQR: "HQR-A0941", status: "pending" },
      { seq: 3, color: "Black", size: "XL", siliconQR: "SQR-00502", designQR: "DQR-00502", hologramQR: "HQR-A0942", status: "pending" },
    ],
  },
];

// Mock QR lookup tables (simulating DB)
const mockTshirtQR: Record<string, { product: string; color: string; size: string }> = {
  "TSH-BK-L": { product: "BT-2024-A", color: "Black", size: "L" },
  "TSH-NV-XL": { product: "BT-2024-A", color: "Navy", size: "XL" },
  "TSH-NV-M": { product: "BT-2024-A", color: "Navy", size: "M" },
  "TSH-WH-M": { product: "BT-2024-B", color: "White", size: "M" },
  "TSH-WH-S": { product: "BT-2024-B", color: "White", size: "S" },
  "TSH-GR-M": { product: "BT-2024-C", color: "Gray", size: "M" },
  "TSH-GR-L": { product: "BT-2024-C", color: "Gray", size: "L" },
  "TSH-BK-XL": { product: "BT-2024-C", color: "Black", size: "XL" },
};
const mockSiliconQR: Record<string, { product: string; design: string }> = {
  "SQR-00479": { product: "BT-2024-B", design: "DSN-012" },
  "SQR-00480": { product: "BT-2024-A", design: "DSN-047" },
  "SQR-00481": { product: "BT-2024-A", design: "DSN-047" },
  "SQR-00482": { product: "BT-2024-A", design: "DSN-047" },
  "SQR-00483": { product: "BT-2024-A", design: "DSN-047" },
  "SQR-00484": { product: "BT-2024-A", design: "DSN-047" },
  "SQR-00491": { product: "BT-2024-B", design: "DSN-012" },
  "SQR-00492": { product: "BT-2024-B", design: "DSN-012" },
  "SQR-00500": { product: "BT-2024-C", design: "DSN-091" },
  "SQR-00501": { product: "BT-2024-C", design: "DSN-091" },
  "SQR-00502": { product: "BT-2024-C", design: "DSN-091" },
};
const mockDesignQR: Record<string, { product: string; design: string }> = {
  "DQR-00479": { product: "BT-2024-A", design: "DSN-047" },
  "DQR-00481": { product: "BT-2024-A", design: "DSN-047" },
  "DQR-00482": { product: "BT-2024-A", design: "DSN-047" },
  "DQR-00483": { product: "BT-2024-A", design: "DSN-047" },
  "DQR-00484": { product: "BT-2024-A", design: "DSN-047" },
  "DQR-00490": { product: "BT-2024-B", design: "DSN-012" },
  "DQR-00491": { product: "BT-2024-B", design: "DSN-012" },
  "DQR-00492": { product: "BT-2024-B", design: "DSN-012" },
  "DQR-00500": { product: "BT-2024-C", design: "DSN-091" },
  "DQR-00501": { product: "BT-2024-C", design: "DSN-091" },
  "DQR-00502": { product: "BT-2024-C", design: "DSN-091" },
};
const mockHoloQR: Record<string, { product: string; design: string; used: boolean }> = {
  "HQR-A0928": { product: "BT-2024-B", design: "DSN-012", used: false },
  "HQR-A0929": { product: "BT-2024-A", design: "DSN-047", used: true },
  "HQR-A0930": { product: "BT-2024-A", design: "DSN-047", used: false },
  "HQR-A0931": { product: "BT-2024-A", design: "DSN-047", used: false },
  "HQR-A0932": { product: "BT-2024-A", design: "DSN-047", used: false },
  "HQR-A0933": { product: "BT-2024-A", design: "DSN-047", used: false },
  "HQR-A0934": { product: "BT-2024-B", design: "DSN-012", used: false },
  "HQR-A0935": { product: "BT-2024-B", design: "DSN-012", used: false },
  "HQR-A0940": { product: "BT-2024-C", design: "DSN-091", used: false },
  "HQR-A0941": { product: "BT-2024-C", design: "DSN-091", used: false },
  "HQR-A0942": { product: "BT-2024-C", design: "DSN-091", used: false },
};

function ProgressBar({ done, total, fail, defectLabel }: { done: number; total: number; fail: number; defectLabel: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = done >= total;
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${isComplete ? "bg-[hsl(var(--success))]" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-16 text-right">{done}/{total}</span>
      {fail > 0 && <span className="text-xs tabular-nums text-destructive">({fail}{defectLabel})</span>}
    </div>
  );
}

function PriorityBadge({ priority, t }: { priority: string; t: (k: string) => string }) {
  const label = priority === "high" ? t("tshirtWork.priorityHigh") : priority === "medium" ? t("tshirtWork.priorityMedium") : t("tshirtWork.priorityLow");
  const cls = priority === "high" ? "bg-destructive/10 text-destructive" : priority === "medium" ? "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]" : "bg-muted text-muted-foreground";
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function StatusBadge({ status, t }: { status: WorkItem["status"]; t: (k: string) => string }) {
  if (status === "done") return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]">{t("tshirtWork.completed")}</span>;
  if (status === "fail") return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">{t("tshirtWork.defects")}</span>;
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t("tshirtWork.pending")}</span>;
}

export default function TshirtWork() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";

  const steps = [
    { key: "tshirt", label: t("tshirtWork.tshirtScan"), icon: Shirt, placeholder: isKo ? "티셔츠 QR을 스캔하세요" : "请扫描T恤QR" },
    { key: "silicon", label: t("tshirtWork.siliconQR"), icon: Sticker, placeholder: isKo ? "실리콘 마크 QR을 스캔하세요" : "请扫描硅胶标QR" },
    { key: "design", label: t("tshirtWork.designQR"), icon: QrCode, placeholder: isKo ? "디자인 QR을 스캔하세요" : "请扫描设计QR" },
    { key: "hologram", label: t("tshirtWork.hologramQR"), icon: Hash, placeholder: isKo ? "홀로그램 QR을 스캔하세요" : "请扫描全息QR" },
  ];

  // 3-level navigation: null → order list, order → work items list, order+workItem → scan view
  const [orders, setOrders] = useState<OrderData[]>(mockOrders);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeWorkItemSeq, setActiveWorkItemSeq] = useState<number | null>(null);

  // Scan state
  const [scanValue, setScanValue] = useState("");
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(["waiting", "waiting", "waiting", "waiting"]);
  const [scannedValues, setScannedValues] = useState<string[]>(["", "", "", ""]);
  const [currentStep, setCurrentStep] = useState(0);
  const [matchedProduct, setMatchedProduct] = useState<{ product: string; design: string } | null>(null);
  const [logoVerified, setLogoVerified] = useState(false);
  const [failReason, setFailReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOrder = orders.find(o => o.id === selectedOrderId) ?? null;
  const activeWorkItem = selectedOrder?.items.find(i => i.seq === activeWorkItemSeq) ?? null;

  const allPass = stepStatuses.every(s => s === "pass");
  const hasFail = stepStatuses.some(s => s === "fail");
  const allDone = stepStatuses.every(s => s === "pass" || s === "fail");

  useEffect(() => {
    if (activeWorkItem && !allDone) inputRef.current?.focus();
  }, [currentStep, activeWorkItem, allDone]);

  const resetScan = useCallback(() => {
    setScanValue(""); setStepStatuses(["waiting", "waiting", "waiting", "waiting"]); setScannedValues(["", "", "", ""]);
    setCurrentStep(0); setMatchedProduct(null); setLogoVerified(false); setFailReason(""); setProcessing(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const processStep = useCallback((step: number, value: string, baseProduct: { product: string; design: string } | null, order: OrderData, workItem: WorkItem) => {
    setProcessing(true);
    setStepStatuses(prev => { const n = [...prev]; n[step] = "scanning"; return n; });
    setScannedValues(prev => { const n = [...prev]; n[step] = value; return n; });
    setTimeout(() => {
      let pass = false; let reason = "";
      if (step === 0) {
        const found = mockTshirtQR[value];
        if (found && found.product === order.product && found.color === workItem.color && found.size === workItem.size) { pass = true; }
        else if (!found) reason = isKo ? `티셔츠 QR [${value}] 기준 데이터에 없음` : `T恤QR [${value}] 基准数据中不存在`;
        else reason = isKo ? `티셔츠 색상/사이즈 불일치 (${found.color}/${found.size} ≠ ${workItem.color}/${workItem.size})` : `T恤颜色/尺码不匹配 (${found.color}/${found.size} ≠ ${workItem.color}/${workItem.size})`;
      } else if (step === 1) {
        const found = mockSiliconQR[value];
        if (found && found.product === order.product && found.design === order.design) { pass = true; setMatchedProduct(found); }
        else if (!found) reason = isKo ? `실리콘 QR [${value}] 기준 데이터에 없음` : `硅胶QR [${value}] 基准数据中不存在`;
        else reason = isKo ? "실리콘 QR 상품/디자인코드 불일치" : "硅胶QR 商品/设计代码不匹配";
      } else if (step === 2) {
        const found = mockDesignQR[value];
        if (found && baseProduct && found.product === baseProduct.product && found.design === baseProduct.design) pass = true;
        else if (!found) reason = isKo ? `디자인 QR [${value}] 기준 데이터에 없음` : `设计QR [${value}] 基准数据中不存在`;
        else reason = isKo ? "디자인 QR 상품/디자인코드 불일치" : "设计QR 商品/设计代码不匹配";
      } else if (step === 3) {
        const found = mockHoloQR[value];
        if (found && baseProduct && found.product === baseProduct.product && found.design === baseProduct.design && !found.used) { pass = true; setLogoVerified(true); }
        else if (!found) reason = isKo ? `홀로그램 QR [${value}] 기준 데이터에 없음` : `全息QR [${value}] 基准数据中不存在`;
        else if (found?.used) reason = isKo ? `홀로그램 QR [${value}] 이미 사용됨 (중복)` : `全息QR [${value}] 已使用（重复）`;
        else reason = isKo ? "홀로그램 QR 상품/디자인코드 불일치" : "全息QR 商品/设计代码不匹配";
      }
      setStepStatuses(prev => { const n = [...prev]; n[step] = pass ? "pass" : "fail"; return n; });
      if (!pass) { setFailReason(reason); setProcessing(false); }
      else if (step < 3) { setCurrentStep(step + 1); setProcessing(false); }
      else { setProcessing(false); }
    }, 400);
  }, [isKo]);

  const handleScan = useCallback(() => {
    const value = scanValue.trim();
    if (!value || processing || !selectedOrder || !activeWorkItem) return;
    setScanValue("");
    if (hasFail || allDone) { resetScan(); return; }
    processStep(currentStep, value, matchedProduct, selectedOrder, activeWorkItem);
  }, [scanValue, processing, currentStep, matchedProduct, selectedOrder, activeWorkItem, hasFail, allDone, processStep, resetScan]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); handleScan(); } };

  const handleConfirmAttach = () => {
    if (!selectedOrder || !activeWorkItem) return;
    // Mark current work item as done
    setOrders(prev => prev.map(o => o.id === selectedOrder.id ? {
      ...o,
      items: o.items.map(item => item.seq === activeWorkItem.seq ? { ...item, status: "done" as const } : item)
    } : o));
    // Auto-advance to next pending item
    const nextPending = selectedOrder.items.find(i => i.seq > activeWorkItem.seq && i.status === "pending");
    if (nextPending) {
      setActiveWorkItemSeq(nextPending.seq);
      resetScan();
    } else {
      setActiveWorkItemSeq(null);
      resetScan();
    }
  };

  const statusIcon = (s: StepStatus) => {
    switch (s) {
      case "waiting": return <span className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center text-xs text-muted-foreground">–</span>;
      case "scanning": return <Loader2 className="w-5 h-5 text-[hsl(var(--warning))] animate-spin" />;
      case "pass": return <CheckCircle2 className="w-5 h-5 text-[hsl(var(--success))]" />;
      case "fail": return <XCircle className="w-5 h-5 text-destructive" />;
    }
  };

  const defectLabel = isKo ? "불량" : "不良";

  // ===== VIEW 1: ORDER LIST =====
  if (!selectedOrderId) {
    return (
      <div>
        <PageHeader title={t("tshirtWork.title")} description={t("tshirtWork.selectOrder")} />
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-4 gap-3 section-enter">
            {[
              { label: t("tshirtWork.totalOrders"), value: orders.length, icon: Package, cls: "text-foreground" },
              { label: t("tshirtWork.inProgress"), value: orders.filter(o => o.items.some(i => i.status === "done") && o.items.some(i => i.status === "pending")).length, icon: Clock, cls: "text-primary" },
              { label: t("tshirtWork.completed"), value: orders.filter(o => o.items.every(i => i.status === "done")).length, icon: CheckCircle2, cls: "text-[hsl(var(--success))]" },
              { label: t("tshirtWork.defectTotal"), value: orders.reduce((a, o) => a + o.items.filter(i => i.status === "fail").length, 0), icon: XCircle, cls: "text-destructive" },
            ].map((s, i) => (
              <div key={s.label} className="kpi-card flex items-center gap-3" style={{ animationDelay: `${i * 50}ms` }}>
                <s.icon className={`w-5 h-5 shrink-0 ${s.cls}`} />
                <div>
                  <p className="text-xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {orders.filter(o => o.items.some(i => i.status === "pending")).length > 0 && (
            <div className="section-enter" style={{ animationDelay: "100ms" }}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("tshirtWork.pendingOrders")}</h3>
              <div className="space-y-2">
                {orders.filter(o => o.items.some(i => i.status === "pending")).map(order => {
                  const done = order.items.filter(i => i.status === "done").length;
                  const fail = order.items.filter(i => i.status === "fail").length;
                  const total = order.items.length;
                  return (
                    <button key={order.id} onClick={() => setSelectedOrderId(order.id)}
                      className="w-full kpi-card flex items-center gap-4 text-left hover:ring-2 hover:ring-primary/30 transition-all duration-150 active:scale-[0.99] cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold">{order.id}</span>
                          <span className="text-xs text-muted-foreground">{order.orderNo}</span>
                          <PriorityBadge priority={order.priority} t={t} />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{t("tshirtWork.product")}: <strong className="text-foreground">{order.product}</strong></span>
                          <span>{t("tshirtWork.design")}: <strong className="text-foreground">{order.design}</strong></span>
                          <span>{t("tshirtWork.dueDate")}: {order.dueDate}</span>
                          <span>{t("tshirtWork.workItems")}: <strong className="text-foreground">{total}{isKo ? "건" : "件"}</strong></span>
                        </div>
                      </div>
                      <ProgressBar done={done} total={total} fail={fail} defectLabel={defectLabel} />
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {orders.filter(o => o.items.every(i => i.status === "done")).length > 0 && (
            <div className="section-enter" style={{ animationDelay: "180ms" }}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("tshirtWork.completedOrders")}</h3>
              <div className="space-y-2 opacity-70">
                {orders.filter(o => o.items.every(i => i.status === "done")).map(order => {
                  const total = order.items.length;
                  const fail = order.items.filter(i => i.status === "fail").length;
                  return (
                    <div key={order.id} className="kpi-card flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />
                          <span className="text-sm font-semibold">{order.id}</span>
                          <span className="text-xs text-muted-foreground">{order.orderNo}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{order.product}</span><span>{order.design}</span>
                        </div>
                      </div>
                      <ProgressBar done={total} total={total} fail={fail} defectLabel={defectLabel} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== VIEW 2: WORK ITEMS LIST =====
  if (!activeWorkItemSeq || !activeWorkItem) {
    if (!selectedOrder) return null;
    const done = selectedOrder.items.filter(i => i.status === "done").length;
    const fail = selectedOrder.items.filter(i => i.status === "fail").length;
    const total = selectedOrder.items.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const firstPending = selectedOrder.items.find(i => i.status === "pending");

    return (
      <div>
        <PageHeader title={t("tshirtWork.title")} description={`${selectedOrder.id} · ${selectedOrder.orderNo}`}>
          <Button variant="outline" size="sm" onClick={() => { setSelectedOrderId(null); }}><ChevronLeft className="w-4 h-4 mr-1" /> {t("tshirtWork.orderList")}</Button>
        </PageHeader>
        <div className="p-6 space-y-6">
          {/* Order summary */}
          <div className="kpi-card section-enter flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              <div><p className="text-xs text-muted-foreground">{t("tshirtWork.order")}</p><p className="text-sm font-semibold">{selectedOrder.id}</p></div>
            </div>
            <div><p className="text-xs text-muted-foreground">{t("tshirtWork.product")}</p><p className="text-sm font-semibold">{selectedOrder.product}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("tshirtWork.design")}</p><p className="text-sm font-semibold">{selectedOrder.design}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("tshirtWork.dueDate")}</p><p className="text-sm font-semibold">{selectedOrder.dueDate}</p></div>
            <PriorityBadge priority={selectedOrder.priority} t={t} />
            <div className="ml-auto flex items-center gap-3">
              <div><p className="text-xs text-muted-foreground text-right">{t("tshirtWork.progressRate")}</p><p className="text-lg font-bold tabular-nums text-right">{pct}%</p></div>
              <div className="w-32 h-3 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} /></div>
              <span className="text-sm tabular-nums text-muted-foreground">{done}/{total}</span>
            </div>
          </div>

          {/* Start work button */}
          {firstPending && (
            <div className="section-enter" style={{ animationDelay: "80ms" }}>
              <Button size="lg" className="w-full" onClick={() => { setActiveWorkItemSeq(firstPending.seq); resetScan(); }}>
                <Shirt className="w-5 h-5 mr-2" />
                {isKo ? `다음 작업 시작 (#${firstPending.seq} · ${firstPending.color} / ${firstPending.size})` : `开始下一项作业 (#${firstPending.seq} · ${firstPending.color} / ${firstPending.size})`}
              </Button>
            </div>
          )}

          {/* Work items table */}
          <div className="kpi-card section-enter" style={{ animationDelay: "120ms" }}>
            <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
              <List className="w-4 h-4" /> {t("tshirtWork.workItems")}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{done}/{total} {t("tshirtWork.completed")}</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left">
                  {["#", t("tshirtWork.color"), t("tshirtWork.size"), t("tshirtWork.siliconQR"), t("tshirtWork.hologramQR"), t("tshirtWork.status")].map(h =>
                    <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                  )}
                  <th className="pb-2"></th>
                </tr></thead>
                <tbody>
                  {selectedOrder.items.map(item => (
                    <tr key={item.seq} className={`border-b last:border-0 transition-colors ${item.status === "pending" ? "hover:bg-muted/30" : ""}`}>
                      <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{item.seq}</td>
                      <td className="py-2.5 pr-4 font-medium">{item.color}</td>
                      <td className="py-2.5 pr-4">{item.size}</td>
                      <td className="py-2.5 font-mono text-xs pr-4">{item.siliconQR}</td>
                      <td className="py-2.5 font-mono text-xs pr-4">{item.hologramQR}</td>
                      <td className="py-2.5 pr-4"><StatusBadge status={item.status} t={t} /></td>
                      <td className="py-2.5">
                        {item.status === "pending" && (
                          <Button variant="outline" size="sm" onClick={() => { setActiveWorkItemSeq(item.seq); resetScan(); }}>
                            <ScanLine className="w-3.5 h-3.5 mr-1" /> {t("tshirtWork.startVerify")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== VIEW 3: SCAN VIEW =====
  return (
    <div>
      <PageHeader title={t("tshirtWork.title")} description={`${selectedOrder!.id} · #${activeWorkItem.seq}`}>
        <Button variant="outline" size="sm" onClick={() => { setActiveWorkItemSeq(null); resetScan(); }}><ChevronLeft className="w-4 h-4 mr-1" /> {t("tshirtWork.workItems")}</Button>
        <Button variant="outline" size="sm" onClick={resetScan}><RotateCcw className="w-4 h-4 mr-1" /> {t("tshirtWork.reset")}</Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        {/* Current work item info */}
        <div className="kpi-card section-enter flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <Shirt className="w-5 h-5 text-primary" />
            <div><p className="text-xs text-muted-foreground">#{activeWorkItem.seq}</p><p className="text-sm font-semibold">{selectedOrder!.id}</p></div>
          </div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.product")}</p><p className="text-sm font-semibold">{selectedOrder!.product}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.design")}</p><p className="text-sm font-semibold">{selectedOrder!.design}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.color")}</p><p className="text-sm font-semibold">{activeWorkItem.color}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.size")}</p><p className="text-sm font-semibold">{activeWorkItem.size}</p></div>
          <div className="ml-auto">
            <p className="text-xs text-muted-foreground text-right">{t("tshirtWork.progressRate")}</p>
            <p className="text-sm font-semibold tabular-nums text-right">
              {selectedOrder!.items.filter(i => i.status === "done").length}/{selectedOrder!.items.length}
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-5 section-enter" style={{ animationDelay: "100ms" }}>
          <div className="lg:col-span-2 space-y-4">
            <div className={`kpi-card border-2 transition-colors duration-300 ${hasFail ? "border-destructive" : allPass ? "border-[hsl(var(--success))]" : "border-border"}`}>
              <h3 className="text-sm font-medium mb-5 flex items-center gap-2"><ScanLine className="w-4 h-4" /> {t("tshirtWork.autoScan")}</h3>
              <div className="space-y-3 mb-5">
                {steps.map((step, i) => {
                  const isActive = i === currentStep && !hasFail && !allDone;
                  return (
                    <div key={step.key} className={`flex items-center gap-3 p-3 rounded-lg transition-colors duration-200 ${isActive ? "bg-primary/5 ring-1 ring-primary/20" : "bg-muted/30"}`}>
                      {statusIcon(stepStatuses[i])}
                      <div className="flex items-center gap-2 w-44 shrink-0">
                        <step.icon className="w-4 h-4 text-muted-foreground" />
                        <span className={`text-sm ${isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>{step.label}</span>
                      </div>
                      <span className="text-sm font-mono text-muted-foreground flex-1 truncate">
                        {scannedValues[i] || (isActive ? t("tshirtWork.scanWaiting") : "")}
                      </span>
                    </div>
                  );
                })}
              </div>

              {!allDone && !hasFail && (
                <div className="flex gap-2">
                  <input ref={inputRef} type="text" value={scanValue} onChange={e => setScanValue(e.target.value)} onKeyDown={handleKeyDown}
                    placeholder={steps[currentStep]?.placeholder ?? ""} disabled={processing}
                    className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" autoFocus />
                  <Button onClick={handleScan} disabled={!scanValue.trim() || processing}>{t("tshirtWork.scan")}</Button>
                </div>
              )}

              {allPass && (
                <div className="mt-4 p-3 rounded-lg bg-[hsl(var(--success)/0.06)] border border-[hsl(var(--success)/0.2)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-[hsl(var(--success))]" />
                    <div>
                      <p className="text-sm font-semibold text-[hsl(var(--success))]">{t("tshirtWork.allPass")}</p>
                      <p className="text-xs text-muted-foreground">{activeWorkItem.color} / {activeWorkItem.size} · {matchedProduct?.product}</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={handleConfirmAttach} className="bg-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.9)] text-white">
                    <CheckCircle2 className="w-4 h-4 mr-1" /> {t("tshirtWork.attachDone")}
                  </Button>
                </div>
              )}
              {hasFail && (
                <div className="mt-4 p-3 rounded-lg bg-destructive/5 border border-destructive/20 flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-destructive">{t("tshirtWork.verifyFail")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{failReason}</p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={resetScan}><RotateCcw className="w-3.5 h-3.5 mr-1" /> {t("tshirtWork.restart")}</Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="kpi-card flex flex-col items-center justify-center min-h-[240px]">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2 self-start"><Image className="w-4 h-4" /> {t("tshirtWork.logoCheck")}</h3>
            {logoVerified && matchedProduct ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <div className="w-32 h-32 rounded-lg border-2 border-[hsl(var(--success)/0.3)] bg-muted/40 flex items-center justify-center overflow-hidden">
                  <img src="/placeholder.svg" alt="Logo" className="max-w-full max-h-full object-contain" />
                </div>
                <span className="text-xs text-[hsl(var(--success))] font-medium flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {t("tshirtWork.logoConfirmed")}</span>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <Image className="w-10 h-10 opacity-30" />
                <p className="text-xs text-center whitespace-pre-line">{t("tshirtWork.logoWait")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
