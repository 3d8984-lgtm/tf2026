import { useState, useRef, useEffect, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ScanLine, CheckCircle2, XCircle, Clock, AlertTriangle,
  Image, Sticker, QrCode, Hash, Shirt, RotateCcw, Loader2,
  ChevronRight, Package
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";

type StepStatus = "waiting" | "scanning" | "pass" | "fail";

interface OrderItem {
  id: string;
  orderNo: string;
  product: string;
  design: string;
  size: string;
  color: string;
  total: number;
  done: number;
  fail: number;
  priority: "high" | "medium" | "low";
  dueDate: string;
}

const mockOrders: OrderItem[] = [
  { id: "WO-001", orderNo: "ORD-2024-1582", product: "BT-2024-A", design: "DSN-047", size: "L", color: "Black", total: 200, done: 142, fail: 3, priority: "high", dueDate: "2024-03-25" },
  { id: "WO-002", orderNo: "ORD-2024-1583", product: "BT-2024-B", design: "DSN-012", size: "M", color: "White", total: 150, done: 150, fail: 0, priority: "medium", dueDate: "2024-03-26" },
  { id: "WO-003", orderNo: "ORD-2024-1584", product: "BT-2024-A", design: "DSN-047", size: "XL", color: "Navy", total: 100, done: 37, fail: 1, priority: "high", dueDate: "2024-03-25" },
  { id: "WO-004", orderNo: "ORD-2024-1585", product: "BT-2024-C", design: "DSN-091", size: "M", color: "Gray", total: 300, done: 0, fail: 0, priority: "medium", dueDate: "2024-03-27" },
  { id: "WO-005", orderNo: "ORD-2024-1586", product: "BT-2024-A", design: "DSN-047", size: "S", color: "Black", total: 80, done: 80, fail: 2, priority: "low", dueDate: "2024-03-28" },
];

const mockLookup: Record<string, { product: string; design: string }> = {
  "SQR-00482": { product: "BT-2024-A", design: "DSN-047" },
  "SQR-00481": { product: "BT-2024-A", design: "DSN-047" },
  "SQR-00480": { product: "BT-2024-A", design: "DSN-047" },
  "SQR-00479": { product: "BT-2024-B", design: "DSN-012" },
};
const mockDesignQR: Record<string, { product: string; design: string }> = {
  "DQR-00482": { product: "BT-2024-A", design: "DSN-047" },
  "DQR-00481": { product: "BT-2024-A", design: "DSN-047" },
  "DQR-00479": { product: "BT-2024-A", design: "DSN-047" },
};
const mockHoloQR: Record<string, { product: string; design: string; used: boolean }> = {
  "HQR-A0931": { product: "BT-2024-A", design: "DSN-047", used: false },
  "HQR-A0930": { product: "BT-2024-A", design: "DSN-047", used: false },
  "HQR-A0929": { product: "BT-2024-A", design: "DSN-047", used: true },
  "HQR-A0928": { product: "BT-2024-B", design: "DSN-012", used: false },
};
const mockTshirtQR: Record<string, { product: string; color: string; size: string }> = {
  "TSH-001": { product: "BT-2024-A", color: "Black", size: "L" },
  "TSH-002": { product: "BT-2024-A", color: "Black", size: "XL" },
  "TSH-003": { product: "BT-2024-B", color: "White", size: "M" },
  "TSH-004": { product: "BT-2024-A", color: "Navy", size: "L" },
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

export default function TshirtWork() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";

  const steps = [
    { key: "tshirt", label: t("tshirtWork.tshirtScan"), icon: Shirt, placeholder: isKo ? "티셔츠 QR을 스캔하세요" : "请扫描T恤QR" },
    { key: "silicon", label: t("tshirtWork.siliconQR"), icon: Sticker, placeholder: isKo ? "실리콘 마크 QR을 스캔하세요" : "请扫描硅胶标QR" },
    { key: "design", label: t("tshirtWork.designQR"), icon: QrCode, placeholder: isKo ? "디자인 QR을 스캔하세요" : "请扫描设计QR" },
    { key: "hologram", label: t("tshirtWork.hologramQR"), icon: Hash, placeholder: isKo ? "홀로그램 QR을 스캔하세요" : "请扫描全息QR" },
  ];

  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(["waiting", "waiting", "waiting"]);
  const [scannedValues, setScannedValues] = useState<string[]>(["", "", ""]);
  const [currentStep, setCurrentStep] = useState(0);
  const [matchedProduct, setMatchedProduct] = useState<{ product: string; design: string } | null>(null);
  const [logoVerified, setLogoVerified] = useState(false);
  const [failReason, setFailReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [workLog, setWorkLog] = useState<Array<{ time: string; result: string; silicon: string; hologram: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const allPass = stepStatuses.every(s => s === "pass");
  const hasFail = stepStatuses.some(s => s === "fail");
  const allDone = stepStatuses.every(s => s === "pass" || s === "fail");

  useEffect(() => {
    if (selectedOrder && !allDone) inputRef.current?.focus();
  }, [currentStep, selectedOrder, allDone]);

  const resetScan = useCallback(() => {
    setScanValue(""); setStepStatuses(["waiting", "waiting", "waiting"]); setScannedValues(["", "", ""]);
    setCurrentStep(0); setMatchedProduct(null); setLogoVerified(false); setFailReason(""); setProcessing(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const processStep = useCallback((step: number, value: string, baseProduct: { product: string; design: string } | null) => {
    setProcessing(true);
    setStepStatuses(prev => { const n = [...prev]; n[step] = "scanning"; return n; });
    setScannedValues(prev => { const n = [...prev]; n[step] = value; return n; });
    setTimeout(() => {
      let pass = false; let reason = "";
      if (step === 0) {
        const found = mockLookup[value];
        if (found) { pass = true; setMatchedProduct(found); }
        else reason = isKo ? `실리콘 QR [${value}] 기준 데이터에 없음` : `硅胶QR [${value}] 基准数据中不存在`;
      } else if (step === 1) {
        const found = mockDesignQR[value];
        if (found && baseProduct && found.product === baseProduct.product && found.design === baseProduct.design) pass = true;
        else if (!found) reason = isKo ? `디자인 QR [${value}] 기준 데이터에 없음` : `设计QR [${value}] 基准数据中不存在`;
        else reason = isKo ? "디자인 QR 상품/디자인코드 불일치" : "设计QR 商品/设计代码不匹配";
      } else if (step === 2) {
        const found = mockHoloQR[value];
        if (found && baseProduct && found.product === baseProduct.product && found.design === baseProduct.design && !found.used) { pass = true; setLogoVerified(true); }
        else if (!found) reason = isKo ? `홀로그램 QR [${value}] 기준 데이터에 없음` : `全息QR [${value}] 基准数据中不存在`;
        else if (found?.used) reason = isKo ? `홀로그램 QR [${value}] 이미 사용됨 (중복)` : `全息QR [${value}] 已使用（重复）`;
        else reason = isKo ? "홀로그램 QR 상품/디자인코드 불일치" : "全息QR 商品/设计代码不匹配";
      }
      setStepStatuses(prev => { const n = [...prev]; n[step] = pass ? "pass" : "fail"; return n; });
      if (!pass) { setFailReason(reason); setProcessing(false); }
      else if (step < 2) { setCurrentStep(step + 1); setProcessing(false); }
      else { setProcessing(false); }
    }, 400);
  }, [isKo]);

  const handleScan = useCallback(() => {
    const value = scanValue.trim();
    if (!value || processing) return;
    setScanValue("");
    if (hasFail || allDone) { resetScan(); return; }
    processStep(currentStep, value, matchedProduct);
  }, [scanValue, processing, currentStep, matchedProduct, hasFail, allDone, processStep, resetScan]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); handleScan(); } };

  const handleConfirmAttach = () => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    setWorkLog(prev => [{ time, result: t("status.attachDone"), silicon: scannedValues[0], hologram: scannedValues[2] }, ...prev]);
    resetScan();
  };

  const statusIcon = (s: StepStatus) => {
    switch (s) {
      case "waiting": return <span className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center text-xs text-muted-foreground">–</span>;
      case "scanning": return <Loader2 className="w-5 h-5 text-[hsl(var(--warning))] animate-spin" />;
      case "pass": return <CheckCircle2 className="w-5 h-5 text-[hsl(var(--success))]" />;
      case "fail": return <XCircle className="w-5 h-5 text-destructive" />;
    }
  };

  // --- ORDER LIST VIEW ---
  if (!selectedOrder) {
    const pending = mockOrders.filter(o => o.done < o.total);
    const completed = mockOrders.filter(o => o.done >= o.total);
    return (
      <div>
        <PageHeader title={t("tshirtWork.title")} description={t("tshirtWork.selectOrder")} />
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-4 gap-3 section-enter">
            {[
              { label: t("tshirtWork.totalOrders"), value: mockOrders.length, icon: Package, cls: "text-foreground" },
              { label: t("tshirtWork.inProgress"), value: pending.length, icon: Clock, cls: "text-primary" },
              { label: t("tshirtWork.completed"), value: completed.length, icon: CheckCircle2, cls: "text-[hsl(var(--success))]" },
              { label: t("tshirtWork.defectTotal"), value: mockOrders.reduce((a, o) => a + o.fail, 0), icon: XCircle, cls: "text-destructive" },
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

          {pending.length > 0 && (
            <div className="section-enter" style={{ animationDelay: "100ms" }}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("tshirtWork.pendingOrders")}</h3>
              <div className="space-y-2">
                {pending.map(order => (
                  <button key={order.id} onClick={() => { setSelectedOrder(order); resetScan(); setWorkLog([]); }}
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
                        <span>{t("tshirtWork.size")}: {order.size}</span>
                        <span>{t("tshirtWork.dueDate")}: {order.dueDate}</span>
                      </div>
                    </div>
                    <ProgressBar done={order.done} total={order.total} fail={order.fail} defectLabel={isKo ? "불량" : "不良"} />
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div className="section-enter" style={{ animationDelay: "180ms" }}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("tshirtWork.completedOrders")}</h3>
              <div className="space-y-2 opacity-70">
                {completed.map(order => (
                  <div key={order.id} className="kpi-card flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />
                        <span className="text-sm font-semibold">{order.id}</span>
                        <span className="text-xs text-muted-foreground">{order.orderNo}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{order.product}</span><span>{order.design}</span><span>{order.size}</span>
                      </div>
                    </div>
                    <ProgressBar done={order.done} total={order.total} fail={order.fail} defectLabel={isKo ? "불량" : "不良"} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- WORK VIEW ---
  const pct = selectedOrder.total > 0 ? Math.round(((selectedOrder.done + workLog.length) / selectedOrder.total) * 100) : 0;

  return (
    <div>
      <PageHeader title={t("tshirtWork.title")} description={`${selectedOrder.id} · ${selectedOrder.orderNo}`}>
        <Button variant="outline" size="sm" onClick={() => setSelectedOrder(null)}>{t("tshirtWork.orderList")}</Button>
        <Button variant="outline" size="sm" onClick={resetScan}><RotateCcw className="w-4 h-4 mr-1" /> {t("tshirtWork.reset")}</Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        <div className="kpi-card section-enter flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <Shirt className="w-5 h-5 text-primary" />
            <div><p className="text-xs text-muted-foreground">{t("tshirtWork.order")}</p><p className="text-sm font-semibold">{selectedOrder.id}</p></div>
          </div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.product")}</p><p className="text-sm font-semibold">{selectedOrder.product}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.design")}</p><p className="text-sm font-semibold">{selectedOrder.design}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.size")}</p><p className="text-sm font-semibold">{selectedOrder.size}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.dueDate")}</p><p className="text-sm font-semibold">{selectedOrder.dueDate}</p></div>
          <PriorityBadge priority={selectedOrder.priority} t={t} />
          <div className="ml-auto flex items-center gap-3">
            <div><p className="text-xs text-muted-foreground text-right">{t("tshirtWork.progressRate")}</p><p className="text-lg font-bold tabular-nums text-right">{pct}%</p></div>
            <div className="w-32 h-3 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} /></div>
            <span className="text-sm tabular-nums text-muted-foreground">{selectedOrder.done + workLog.length}/{selectedOrder.total}</span>
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
                      <div className="flex items-center gap-2 w-40 shrink-0">
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
                      {matchedProduct && <p className="text-xs text-muted-foreground">{matchedProduct.product} · {matchedProduct.design}</p>}
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

        {workLog.length > 0 && (
          <div className="kpi-card section-enter" style={{ animationDelay: "180ms" }}>
            <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" /> {t("tshirtWork.sessionLog")}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{workLog.length}{t("tshirtWork.doneCount")}</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left">
                  {["#", t("common.time"), t("tshirtProd.siliconQR"), t("tshirtProd.hologramQR"), t("tshirtProd.result")].map(h =>
                    <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {workLog.map((row, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{workLog.length - i}</td>
                      <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{row.time}</td>
                      <td className="py-2.5 font-mono text-xs pr-4">{row.silicon}</td>
                      <td className="py-2.5 font-mono text-xs pr-4">{row.hologram}</td>
                      <td className="py-2.5"><span className="status-badge status-running">{row.result}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
