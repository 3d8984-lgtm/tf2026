import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import PageHeader from "@/components/PageHeader";
import { useOrders } from "@/hooks/useDbData";
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
  orderDate: string;
  dueDate: string;
  items: WorkItem[];
}

// QR lookup tables will be populated from DB in the future
const mockTshirtQR: Record<string, { product: string; color: string; size: string }> = {};
const mockSiliconQR: Record<string, { product: string; design: string }> = {};
const mockDesignQR: Record<string, { product: string; design: string }> = {};
const mockHoloQR: Record<string, { product: string; design: string; used: boolean }> = {};

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
  const [orders, setOrders] = useState<OrderData[]>([]);
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
                          <span className="text-sm font-semibold">{order.orderNo}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{isKo ? "트윈커" : "Twinker"}: <strong className="text-foreground">{order.twinker}</strong></span>
                          <span>{t("tshirtWork.orderDate")}: {order.orderDate}</span>
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
                          <span className="text-sm font-semibold">{order.orderNo}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{isKo ? "트윈커" : "Twinker"}: {order.twinker}</span>
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
              <div><p className="text-xs text-muted-foreground">{t("tshirtWork.order")}</p><p className="text-sm font-semibold">{selectedOrder.orderNo}</p></div>
            </div>
            <div><p className="text-xs text-muted-foreground">{isKo ? "트윈커" : "Twinker"}</p><p className="text-sm font-semibold">{selectedOrder.twinker}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("tshirtWork.dueDate")}</p><p className="text-sm font-semibold">{selectedOrder.dueDate}</p></div>
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

        {/* Large O/X result indicator - always visible */}
        {(allPass || hasFail) && (
          <div className={`section-enter rounded-xl border-2 p-6 flex items-center justify-between ${allPass ? "border-[hsl(var(--success))] bg-[hsl(var(--success)/0.06)]" : "border-destructive bg-destructive/5"}`}>
            <div className="flex items-center gap-5">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl font-black ${allPass ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]" : "bg-destructive/10 text-destructive"}`}>
                {allPass ? "O" : "X"}
              </div>
              <div>
                <p className={`text-xl font-bold ${allPass ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                  {allPass ? t("tshirtWork.allPass") : t("tshirtWork.verifyFail")}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {allPass ? `${activeWorkItem.color} / ${activeWorkItem.size} · ${matchedProduct?.product}` : failReason}
                </p>
              </div>
            </div>
            {allPass ? (
              <Button size="lg" onClick={handleConfirmAttach} className="bg-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.9)] text-white">
                <CheckCircle2 className="w-5 h-5 mr-2" /> {t("tshirtWork.attachDone")}
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={resetScan}>
                <RotateCcw className="w-4 h-4 mr-2" /> {t("tshirtWork.restart")}
              </Button>
            )}
          </div>
        )}

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
