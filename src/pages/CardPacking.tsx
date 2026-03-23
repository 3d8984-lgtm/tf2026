import PageHeader from "@/components/PageHeader";
import { CheckCircle2, XCircle, ScanLine } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

const packLogs = [
  { time: "14:36:01", barcode: "CRD-20240315-0482", serial: "CS-A09312", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0482", status: "ejected" },
  { time: "14:35:42", barcode: "CRD-20240315-0481", serial: "CS-A09311", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0481", status: "ejected" },
  { time: "14:35:20", barcode: "CRD-20240315-0480", serial: "CS-A09310", product: "BT-2024-B", design: "DSN-012", printedQR: "-", status: "error" },
  { time: "14:34:58", barcode: "CRD-20240315-0479", serial: "CS-A09309", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0479", status: "qrPrinted" },
];

const statusBadge: Record<string, string> = {
  scanDone: "status-idle", packing: "status-warning", qrPrinted: "status-running", ejected: "status-running", error: "status-stopped",
};

export default function CardPacking() {
  const { t } = useLang();

  const statusLabel: Record<string, string> = {
    scanDone: t("status.scanDone"), packing: t("status.packing"), qrPrinted: t("status.qrPrinted"), ejected: t("status.ejected"), error: t("status.error"),
  };

  const stats = [
    { label: t("status.scanDone"), value: 1247, cls: "status-idle" },
    { label: t("status.packing"), value: 3, cls: "status-warning" },
    { label: t("status.ejected"), value: 1198, cls: "status-running" },
    { label: t("status.error"), value: 4, cls: "status-stopped" },
  ];

  const headers = [
    t("cardPacking.time"), t("cardPacking.barcode"), t("cardPacking.serial"),
    t("cardPacking.productCode"), t("cardPacking.designCode"), t("cardPacking.printedQR"), t("cardPacking.status"),
  ];

  return (
    <div>
      <PageHeader title={t("cardPacking.title")} description={t("cardPacking.desc")} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
              <p className="text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</p>
              <span className={`status-badge mt-2 ${s.cls}`}>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="kpi-card section-enter" style={{ animationDelay: "260ms" }}>
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2"><ScanLine className="w-4 h-4" /> {t("cardPacking.log")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">{headers.map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}</tr></thead>
              <tbody>
                {packLogs.map((l, i) => (
                  <tr key={i} className={`border-b last:border-0 ${l.status === "error" ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                    <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{l.time}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.barcode}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.serial}</td>
                    <td className="py-2.5 pr-4">{l.product}</td>
                    <td className="py-2.5 pr-4">{l.design}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.printedQR}</td>
                    <td className="py-2.5"><span className={`status-badge ${statusBadge[l.status]}`}>{statusLabel[l.status]}</span></td>
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
