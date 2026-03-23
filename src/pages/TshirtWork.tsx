import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ScanLine, CheckCircle2, XCircle, Clock, AlertTriangle,
  Image, Sticker, QrCode, Hash, Shirt, RotateCcw
} from "lucide-react";

type VerifyStatus = "idle" | "scanning" | "pass" | "fail";

interface ScanField {
  key: string;
  label: string;
  icon: React.ElementType;
  placeholder: string;
}

const scanFields: ScanField[] = [
  { key: "silicon", label: "실리콘 마크 QR", icon: Sticker, placeholder: "실리콘 마크 QR을 스캔하세요" },
  { key: "design", label: "디자인 QR", icon: QrCode, placeholder: "디자인 QR을 스캔하세요" },
  { key: "hologram", label: "일련번호 홀로그램 QR", icon: Hash, placeholder: "홀로그램 QR을 스캔하세요" },
];

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
  const [scans, setScans] = useState<Record<string, string>>({ silicon: "", design: "", hologram: "" });
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [matchedProduct, setMatchedProduct] = useState<{ product: string; design: string; logo: string } | null>(null);

  const allScanned = scanFields.every(f => scans[f.key].trim().length > 0);

  const handleScanChange = (key: string, value: string) => {
    setScans(prev => ({ ...prev, [key]: value }));
    setVerifyStatus("idle");
    setMatchedProduct(null);
  };

  const handleVerify = () => {
    setVerifyStatus("scanning");
    // Simulate verification
    setTimeout(() => {
      const pass = Math.random() > 0.15;
      setVerifyStatus(pass ? "pass" : "fail");
      if (pass) {
        setMatchedProduct({ product: "BT-2024-A", design: "DSN-047", logo: "/placeholder.svg" });
      } else {
        setMatchedProduct(null);
      }
    }, 800);
  };

  const handleReset = () => {
    setScans({ silicon: "", design: "", hologram: "" });
    setVerifyStatus("idle");
    setMatchedProduct(null);
  };

  const statusColor = {
    idle: "border-border",
    scanning: "border-warning",
    pass: "border-success",
    fail: "border-destructive",
  };

  return (
    <div>
      <PageHeader title="티셔츠 부착 작업" description="실리콘 마크·디자인·홀로그램 QR 스캔 후 부착물 검증 및 작업 진행">
        <Button variant="outline" size="sm" onClick={handleReset}>
          <RotateCcw className="w-4 h-4 mr-1" /> 초기화
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        {/* Today stats bar */}
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

        {/* Main work area: scan + logo */}
        <div className="grid lg:grid-cols-3 gap-5 section-enter" style={{ animationDelay: "120ms" }}>
          {/* Scan inputs */}
          <div className="lg:col-span-2 space-y-4">
            <div className={`kpi-card border-2 transition-colors duration-300 ${statusColor[verifyStatus]}`}>
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                <ScanLine className="w-4 h-4" /> QR 스캔 검증
              </h3>
              <div className="space-y-3">
                {scanFields.map(f => (
                  <div key={f.key} className="flex items-center gap-3">
                    <div className="flex items-center gap-2 w-44 shrink-0">
                      <f.icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{f.label}</span>
                    </div>
                    <input
                      type="text"
                      value={scans[f.key]}
                      onChange={e => handleScanChange(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {scans[f.key] && (
                      <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))] shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              {/* Verify button */}
              <div className="mt-5 flex items-center gap-3">
                <Button
                  onClick={handleVerify}
                  disabled={!allScanned || verifyStatus === "scanning"}
                  className="min-w-[120px]"
                >
                  {verifyStatus === "scanning" ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      검증중…
                    </span>
                  ) : "검증 시작"}
                </Button>

                {verifyStatus === "pass" && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--success))]">
                    <CheckCircle2 className="w-4 h-4" /> 검증 통과 — 부착 가능
                  </span>
                )}
                {verifyStatus === "fail" && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                    <AlertTriangle className="w-4 h-4" /> 검증 실패 — QR 정보 불일치
                  </span>
                )}
              </div>

              {/* Matched product info */}
              {matchedProduct && (
                <div className="mt-4 p-3 rounded-lg bg-[hsl(var(--success)/0.06)] border border-[hsl(var(--success)/0.2)]">
                  <p className="text-sm font-medium text-foreground mb-1">매칭된 상품 정보</p>
                  <div className="flex gap-6 text-sm text-muted-foreground">
                    <span>상품코드: <strong className="text-foreground">{matchedProduct.product}</strong></span>
                    <span>디자인코드: <strong className="text-foreground">{matchedProduct.design}</strong></span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Logo verification panel */}
          <div className="kpi-card flex flex-col items-center justify-center min-h-[240px]">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2 self-start">
              <Image className="w-4 h-4" /> 로고 확인
            </h3>
            {matchedProduct ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <div className="w-32 h-32 rounded-lg border-2 border-[hsl(var(--success)/0.3)] bg-muted/40 flex items-center justify-center overflow-hidden">
                  <img src={matchedProduct.logo} alt="로고" className="max-w-full max-h-full object-contain" />
                </div>
                <span className="text-xs text-[hsl(var(--success))] font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 로고 확인됨
                </span>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <Image className="w-10 h-10 opacity-30" />
                <p className="text-xs">QR 검증 통과 시 로고가 표시됩니다</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent work log */}
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
                      {row.logo ? (
                        <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />
                      ) : (
                        <XCircle className="w-4 h-4 text-destructive" />
                      )}
                    </td>
                    <td className="py-2.5">
                      <span className={`status-badge ${row.result === "부착완료" ? "status-running" : "status-stopped"}`}>
                        {row.result}
                      </span>
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
