import { useState, useRef, useEffect, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ScanLine, CheckCircle2, XCircle, Clock, AlertTriangle,
  Image, Sticker, QrCode, Hash, Shirt, RotateCcw, Loader2
} from "lucide-react";

type StepStatus = "waiting" | "scanning" | "pass" | "fail";

interface Step {
  key: string;
  label: string;
  icon: React.ElementType;
  placeholder: string;
}

const steps: Step[] = [
  { key: "silicon", label: "실리콘 마크 QR", icon: Sticker, placeholder: "실리콘 마크 QR을 스캔하세요" },
  { key: "design", label: "디자인 QR", icon: QrCode, placeholder: "디자인 QR을 스캔하세요" },
  { key: "hologram", label: "홀로그램 QR", icon: Hash, placeholder: "홀로그램 QR을 스캔하세요" },
];

// Simulated DB lookup
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

const recentWork = [
  { id: 1, time: "14:35:22", product: "BT-2024-A", design: "DSN-047", silicon: "SQR-00482", hologram: "HQR-A0931", logo: true, result: "부착완료" },
  { id: 2, time: "14:34:58", product: "BT-2024-A", design: "DSN-047", silicon: "SQR-00481", hologram: "HQR-A0930", logo: true, result: "부착완료" },
  { id: 3, time: "14:34:31", product: "BT-2024-A", design: "DSN-047", silicon: "SQR-00480", hologram: "HQR-A0929", logo: false, result: "검증실패" },
  { id: 4, time: "14:34:02", product: "BT-2024-B", design: "DSN-012", silicon: "SQR-00479", hologram: "HQR-A0928", logo: true, result: "부착완료" },
  { id: 5, time: "14:33:40", product: "BT-2024-C", design: "DSN-091", silicon: "SQR-00478", hologram: "HQR-A0927", logo: true, result: "부착완료" },
  { id: 6, time: "14:33:11", product: "BT-2024-A", design: "DSN-047", silicon: "SQR-00477", hologram: "HQR-A0926", logo: true, result: "부착완료" },
];

const todayStats = { total: 1007, done: 876, fail: 7, waiting: 124 };

export default function TshirtWork() {
  const [scanValue, setScanValue] = useState("");
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(["waiting", "waiting", "waiting"]);
  const [scannedValues, setScannedValues] = useState<string[]>(["", "", ""]);
  const [currentStep, setCurrentStep] = useState(0); // 0=silicon, 1=design, 2=hologram
  const [matchedProduct, setMatchedProduct] = useState<{ product: string; design: string } | null>(null);
  const [logoVerified, setLogoVerified] = useState(false);
  const [failReason, setFailReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const allDone = stepStatuses.every(s => s === "pass" || s === "fail");
  const allPass = stepStatuses.every(s => s === "pass");
  const hasFail = stepStatuses.some(s => s === "fail");

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [currentStep]);

  const handleReset = useCallback(() => {
    setScanValue("");
    setStepStatuses(["waiting", "waiting", "waiting"]);
    setScannedValues(["", "", ""]);
    setCurrentStep(0);
    setMatchedProduct(null);
    setLogoVerified(false);
    setFailReason("");
    setProcessing(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const processStep = useCallback((step: number, value: string, baseProduct: { product: string; design: string } | null) => {
    setProcessing(true);
    setStepStatuses(prev => { const n = [...prev]; n[step] = "scanning"; return n; });
    setScannedValues(prev => { const n = [...prev]; n[step] = value; return n; });

    setTimeout(() => {
      let pass = false;
      let reason = "";

      if (step === 0) {
        // Silicon QR lookup
        const found = mockLookup[value];
        if (found) {
          pass = true;
          setMatchedProduct(found);
        } else {
          reason = `실리콘 QR [${value}] 기준 데이터에 없음`;
        }
      } else if (step === 1) {
        // Design QR: must match product/design from step 0
        const found = mockDesignQR[value];
        if (found && baseProduct && found.product === baseProduct.product && found.design === baseProduct.design) {
          pass = true;
        } else if (!found) {
          reason = `디자인 QR [${value}] 기준 데이터에 없음`;
        } else {
          reason = `디자인 QR 상품/디자인코드 불일치`;
        }
      } else if (step === 2) {
        // Hologram QR: must match + not used
        const found = mockHoloQR[value];
        if (found && baseProduct && found.product === baseProduct.product && found.design === baseProduct.design && !found.used) {
          pass = true;
          setLogoVerified(true);
        } else if (!found) {
          reason = `홀로그램 QR [${value}] 기준 데이터에 없음`;
        } else if (found?.used) {
          reason = `홀로그램 QR [${value}] 이미 사용됨 (중복)`;
        } else {
          reason = `홀로그램 QR 상품/디자인코드 불일치`;
        }
      }

      setStepStatuses(prev => { const n = [...prev]; n[step] = pass ? "pass" : "fail"; return n; });

      if (!pass) {
        setFailReason(reason);
        setProcessing(false);
      } else if (step < 2) {
        // Auto-advance to next step
        setCurrentStep(step + 1);
        setProcessing(false);
      } else {
        setProcessing(false);
      }
    }, 500);
  }, []);

  const handleScan = useCallback(() => {
    const value = scanValue.trim();
    if (!value || processing) return;
    setScanValue("");

    if (hasFail || allDone) {
      // If previous cycle failed or done, auto-reset and start fresh
      handleReset();
      return;
    }

    processStep(currentStep, value, matchedProduct);
  }, [scanValue, processing, currentStep, matchedProduct, hasFail, allDone, processStep, handleReset]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan();
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

  return (
    <div>
      <PageHeader title="티셔츠 부착 작업" description="QR을 순서대로 스캔하면 자동 검증됩니다">
        <Button variant="outline" size="sm" onClick={handleReset}>
          <RotateCcw className="w-4 h-4 mr-1" /> 초기화
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        {/* Today stats */}
        <div className="grid grid-cols-4 gap-3 section-enter">
          {[
            { label: "오늘 목표", value: todayStats.total, icon: Shirt, cls: "text-foreground" },
            { label: "부착완료", value: todayStats.done, icon: CheckCircle2, cls: "text-[hsl(var(--success))]" },
            { label: "검증실패", value: todayStats.fail, icon: XCircle, cls: "text-destructive" },
            { label: "대기", value: todayStats.waiting, icon: Clock, cls: "text-muted-foreground" },
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

        {/* Main work area */}
        <div className="grid lg:grid-cols-3 gap-5 section-enter" style={{ animationDelay: "120ms" }}>
          {/* Scan + auto-verify */}
          <div className="lg:col-span-2 space-y-4">
            <div className={`kpi-card border-2 transition-colors duration-300 ${
              hasFail ? "border-destructive" : allPass ? "border-[hsl(var(--success))]" : "border-border"
            }`}>
              <h3 className="text-sm font-medium mb-5 flex items-center gap-2">
                <ScanLine className="w-4 h-4" /> 자동 검증 스캔
              </h3>

              {/* Step indicators */}
              <div className="space-y-3 mb-5">
                {steps.map((step, i) => {
                  const isActive = i === currentStep && !hasFail && !allDone;
                  return (
                    <div
                      key={step.key}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-colors duration-200 ${
                        isActive ? "bg-primary/5 ring-1 ring-primary/20" : "bg-muted/30"
                      }`}
                    >
                      {statusIcon(stepStatuses[i])}
                      <div className="flex items-center gap-2 w-40 shrink-0">
                        <step.icon className="w-4 h-4 text-muted-foreground" />
                        <span className={`text-sm ${isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>
                          {step.label}
                        </span>
                      </div>
                      <span className="text-sm font-mono text-muted-foreground flex-1 truncate">
                        {scannedValues[i] || (isActive ? "← 스캔 대기중" : "")}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Single scan input */}
              {!allDone && !hasFail && (
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={scanValue}
                    onChange={e => setScanValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={steps[currentStep]?.placeholder ?? "스캔하세요"}
                    disabled={processing}
                    className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    autoFocus
                  />
                  <Button onClick={handleScan} disabled={!scanValue.trim() || processing} size="default">
                    스캔
                  </Button>
                </div>
              )}

              {/* Result message */}
              {allPass && (
                <div className="mt-4 p-3 rounded-lg bg-[hsl(var(--success)/0.06)] border border-[hsl(var(--success)/0.2)] flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-[hsl(var(--success))] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-[hsl(var(--success))]">전체 검증 통과 — 부착 진행 가능</p>
                    {matchedProduct && (
                      <p className="text-xs text-muted-foreground mt-1">
                        상품코드: <strong className="text-foreground">{matchedProduct.product}</strong> · 디자인코드: <strong className="text-foreground">{matchedProduct.design}</strong>
                      </p>
                    )}
                  </div>
                </div>
              )}
              {hasFail && (
                <div className="mt-4 p-3 rounded-lg bg-destructive/5 border border-destructive/20 flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-destructive">검증 실패 — 작업 중단</p>
                    <p className="text-xs text-muted-foreground mt-1">{failReason}</p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={handleReset}>
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> 다시 시작
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Logo panel */}
          <div className="kpi-card flex flex-col items-center justify-center min-h-[240px]">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2 self-start">
              <Image className="w-4 h-4" /> 로고 확인
            </h3>
            {logoVerified && matchedProduct ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <div className="w-32 h-32 rounded-lg border-2 border-[hsl(var(--success)/0.3)] bg-muted/40 flex items-center justify-center overflow-hidden">
                  <img src="/placeholder.svg" alt="로고" className="max-w-full max-h-full object-contain" />
                </div>
                <span className="text-xs text-[hsl(var(--success))] font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 로고 확인됨
                </span>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <Image className="w-10 h-10 opacity-30" />
                <p className="text-xs text-center">전체 QR 검증 통과 시<br/>로고가 표시됩니다</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent work */}
        <div className="kpi-card section-enter" style={{ animationDelay: "200ms" }}>
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" /> 최근 작업 이력
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {["시간", "상품코드", "디자인코드", "실리콘QR", "홀로그램QR", "로고", "판정"].map(h => (
                    <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentWork.map(row => (
                  <tr key={row.id} className={`border-b last:border-0 transition-colors ${row.result === "검증실패" ? "bg-destructive/5" : "hover:bg-muted/30"}`}>
                    <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{row.time}</td>
                    <td className="py-2.5 pr-4">{row.product}</td>
                    <td className="py-2.5 pr-4">{row.design}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{row.silicon}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{row.hologram}</td>
                    <td className="py-2.5 pr-4">
                      {row.logo ? <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" /> : <XCircle className="w-4 h-4 text-destructive" />}
                    </td>
                    <td className="py-2.5">
                      <span className={`status-badge ${row.result === "부착완료" ? "status-running" : "status-stopped"}`}>{row.result}</span>
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
