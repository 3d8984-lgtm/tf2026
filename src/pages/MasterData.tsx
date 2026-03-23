import PageHeader from "@/components/PageHeader";
import { Database } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

export default function MasterData() {
  const { t } = useLang();

  const masters = [
    { category: t("master.product"), count: 247, lastUpdate: "2024-03-15" },
    { category: t("master.design"), count: 89, lastUpdate: "2024-03-14" },
    { category: t("master.logo"), count: 89, lastUpdate: "2024-03-14" },
    { category: t("master.cardMaster"), count: 312, lastUpdate: "2024-03-15" },
    { category: t("master.qrBarcode"), count: 14820, lastUpdate: "2024-03-15" },
    { category: t("master.shipper"), count: 5, lastUpdate: "2024-02-28" },
  ];

  return (
    <div>
      <PageHeader title={t("master.title")} description={t("master.desc")} />
      <div className="p-6">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {masters.map((m, i) => (
            <div key={m.category} className="kpi-card section-enter cursor-pointer hover:border-primary/30" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{m.category}</p>
                  <p className="text-xs text-muted-foreground">{m.count.toLocaleString()}{t("master.items")} · {t("master.lastUpdate")} {m.lastUpdate}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
