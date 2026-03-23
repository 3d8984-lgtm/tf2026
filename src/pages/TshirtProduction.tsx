import PageHeader from "@/components/PageHeader";
import { CheckCircle2, XCircle, Clock, Shirt, ScanLine } from "lucide-react";

const scanLogs = [
  { time: "14:35:22", silicon: "SQR-00482", design: "DQR-00482", hologram: "HQR-A0931", product: "BT-2024-A", designCode: "DSN-047", result: "부착완료", logo: "✓" },
  { time: "14:34:58", silicon: "SQR-00481", design: "DQR-00481", hologram: "HQR-A0930", product: "BT-2024-A", designCode: "DSN-047", result: "부착완료", logo: "✓" },
  { time: "14:34:31", silicon: "SQR-00480", design: "DQR-00479", hologram: "HQR-A0929", product: "BT-2024-A", designCode: "DSN-047", result: "검증실패", logo: "-" },
  { time: "14:34:02", silicon: "SQR-00479", design: "DQR-00479", hologram: "HQR-A0928", product: "BT-2024-B", designCode: "DSN-012", result: "부착완료", logo: "✓" },
];

const stats = [
  { label: "대기", count: 124, icon: Clock, cls: "status-idle" },
  { label: "부착완료", count: 876, icon: CheckCircle2, cls: "status-running" },
  { label: "검증실패", count: 7, icon: XCircle, cls: "status-stopped" },
];

export default function TshirtProduction() {
  return (
    <div>
      <PageHeader title="티셔츠 제작 관리" description="실리콘 마크·디자인·홀로그램 QR 검증 및 부착 관리" />
      <div className="p-6 space-y-6">
        {/* Status summary */}
        <div className="grid grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <div key={s.label} className="kpi-card section-enter flex items-center gap-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className={`p-2.5 rounded-lg ${s.cls}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{s.count}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Scan verification area */}
        <div className="kpi-card section-enter" style={{ animationDelay: "200ms" }}>
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
            <ScanLine className="w-4 h-4" /> 실시간 스캔 로그
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {["시간", "실리콘QR", "디자인QR", "홀로그램QR", "상품코드", "디자인코드", "로고", "판정"].map((h) => (
                    <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scanLogs.map((log, i) => (
                  <tr key={i} className={`border-b last:border-0 transition-colors ${log.result === "검증실패" ? "bg-destructive/5" : "hover:bg-muted/30"}`}>
                    <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{log.time}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{log.silicon}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{log.design}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{log.hologram}</td>
                    <td className="py-2.5 pr-4">{log.product}</td>
                    <td className="py-2.5 pr-4">{log.designCode}</td>
                    <td className="py-2.5 pr-4">{log.logo}</td>
                    <td className="py-2.5">
                      <span className={`status-badge ${log.result === "부착완료" ? "status-running" : "status-stopped"}`}>
                        {log.result}
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
