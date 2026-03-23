import PageHeader from "@/components/PageHeader";
import { Search, FileBarChart } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

export default function Reports() {
  const { t } = useLang();

  const reports = [
    t("reports.dailyProd"), t("reports.dailyCard"), t("reports.dailySet"),
    t("reports.dailyShip"), t("reports.machineUptime"), t("reports.defectRate"),
    t("reports.workerOutput"), t("reports.designQty"),
  ];

  return (
    <div>
      <PageHeader title={t("reports.title")} description={t("reports.desc")} />
      <div className="p-6 space-y-6">
        <div className="kpi-card section-enter">
          <h3 className="text-sm font-medium mb-3">{t("reports.trace")}</h3>
          <p className="text-xs text-muted-foreground mb-3">{t("reports.traceDesc")}</p>
          <div className="relative max-w-lg">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("reports.searchPlaceholder")} />
          </div>
        </div>
        <div className="kpi-card section-enter" style={{ animationDelay: "120ms" }}>
          <h3 className="text-sm font-medium mb-4">{t("reports.basic")}</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {reports.map((r) => (
              <button key={r} className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary/40 text-sm text-left transition-all active:scale-[0.97]">
                <FileBarChart className="w-4 h-4 text-primary shrink-0" /> {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
