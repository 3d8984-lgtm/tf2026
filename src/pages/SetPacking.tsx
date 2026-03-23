import PageHeader from "@/components/PageHeader";
import { CheckCircle2, XCircle, Package } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

const setLogs = [
  { time: "14:37:01", setId: "SET-20240315-0312", tshirtQR: "DQR-00482", cardQR: "CPQ-0482", product: "BT-2024-A", design: "DSN-047", match: true, status: "packDone" },
  { time: "14:36:38", setId: "SET-20240315-0311", tshirtQR: "DQR-00481", cardQR: "CPQ-0481", product: "BT-2024-A", design: "DSN-047", match: true, status: "packDone" },
  { time: "14:36:12", setId: "-", tshirtQR: "DQR-00480", cardQR: "CPQ-0478", product: "BT-2024-A / BT-2024-B", design: "DSN-047 / DSN-012", match: false, status: "matchFail" },
  { time: "14:35:50", setId: "SET-20240315-0310", tshirtQR: "DQR-00479", cardQR: "CPQ-0479", product: "BT-2024-B", design: "DSN-012", match: true, status: "packDone" },
];

export default function SetPacking() {
  const { t } = useLang();

  const headers = [
    t("setPacking.time"), t("setPacking.setId"), t("setPacking.tshirtQR"), t("setPacking.cardQR"),
    t("setPacking.productCode"), t("setPacking.designCode"), t("setPacking.match"), t("setPacking.status"),
  ];

  return (
    <div>
      <PageHeader title={t("setPacking.title")} description={t("setPacking.desc")} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t("setPacking.matchWait"), value: 178 },
            { label: t("setPacking.packDone"), value: 654 },
            { label: t("setPacking.matchFail"), value: 3 },
          ].map((s, i) => (
            <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
              <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="kpi-card section-enter" style={{ animationDelay: "200ms" }}>
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2"><Package className="w-4 h-4" /> {t("setPacking.matchLog")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">{headers.map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}</tr></thead>
              <tbody>
                {setLogs.map((l, i) => (
                  <tr key={i} className={`border-b last:border-0 ${!l.match ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                    <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{l.time}</td>
                    <td className="py-2.5 font-medium pr-4">{l.setId !== "-" ? <span className="text-primary">{l.setId}</span> : "-"}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.tshirtQR}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.cardQR}</td>
                    <td className="py-2.5 pr-4">{l.product}</td>
                    <td className="py-2.5 pr-4">{l.design}</td>
                    <td className="py-2.5 pr-4">{l.match ? <CheckCircle2 className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-destructive" />}</td>
                    <td className="py-2.5"><span className={`status-badge ${l.match ? "status-running" : "status-stopped"}`}>{l.status === "packDone" ? t("status.packDone") : t("status.matchFail")}</span></td>
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
