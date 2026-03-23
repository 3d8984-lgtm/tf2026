import PageHeader from "@/components/PageHeader";
import { CheckCircle2, XCircle, ScanLine, Printer, Package } from "lucide-react";

const packLogs = [
  { time: "14:36:01", barcode: "CRD-20240315-0482", serial: "CS-A09312", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0482", status: "배출완료" },
  { time: "14:35:42", barcode: "CRD-20240315-0481", serial: "CS-A09311", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0481", status: "배출완료" },
  { time: "14:35:20", barcode: "CRD-20240315-0480", serial: "CS-A09310", product: "BT-2024-B", design: "DSN-012", printedQR: "-", status: "오류" },
  { time: "14:34:58", barcode: "CRD-20240315-0479", serial: "CS-A09309", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0479", status: "QR인쇄완료" },
];

const statusMap: Record<string, string> = {
  "스캔완료": "status-idle",
  "포장중": "status-warning",
  "QR인쇄완료": "status-running",
  "배출완료": "status-running",
  "오류": "status-stopped",
};

export default function CardPacking() {
  return (
    <div>
      <PageHeader title="카드 포장 관리" description="카드 바코드 스캔, 포장기계 동작, QR 인쇄 관리" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "스캔완료", value: 1247, cls: "status-idle" },
            { label: "포장중", value: 3, cls: "status-warning" },
            { label: "배출완료", value: 1198, cls: "status-running" },
            { label: "오류", value: 4, cls: "status-stopped" },
          ].map((s, i) => (
            <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
              <p className="text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</p>
              <span className={`status-badge mt-2 ${s.cls}`}>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="kpi-card section-enter" style={{ animationDelay: "260ms" }}>
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2"><ScanLine className="w-4 h-4" /> 포장 로그</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {["시간", "카드바코드", "일련번호", "상품코드", "디자인코드", "인쇄QR", "상태"].map(h => (
                    <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {packLogs.map((l, i) => (
                  <tr key={i} className={`border-b last:border-0 ${l.status === "오류" ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                    <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{l.time}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.barcode}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.serial}</td>
                    <td className="py-2.5 pr-4">{l.product}</td>
                    <td className="py-2.5 pr-4">{l.design}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.printedQR}</td>
                    <td className="py-2.5"><span className={`status-badge ${statusMap[l.status]}`}>{l.status}</span></td>
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
