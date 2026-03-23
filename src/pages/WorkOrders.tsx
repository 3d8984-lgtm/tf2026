import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

export default function WorkOrders() {
  const { t, lang } = useLang();

  const workOrders = [
    { id: "WO-20240315-001", product: "BT-2024-A", design: "DSN-047", qty: 500, date: "2024-03-15", line: lang === "ko" ? "라인 A" : "产线 A", assignee: lang === "ko" ? "김작업" : "金作业", status: t("status.inProgress") },
    { id: "WO-20240315-002", product: "BT-2024-B", design: "DSN-012", qty: 300, date: "2024-03-15", line: lang === "ko" ? "라인 B" : "产线 B", assignee: lang === "ko" ? "이작업" : "李作业", status: t("status.waiting") },
    { id: "WO-20240314-005", product: "BT-2024-C", design: "DSN-089", qty: 800, date: "2024-03-14", line: lang === "ko" ? "라인 A" : "产线 A", assignee: lang === "ko" ? "김작업" : "金作业", status: t("status.completed") },
    { id: "WO-20240314-004", product: "BT-2024-A", design: "DSN-047", qty: 450, date: "2024-03-14", line: lang === "ko" ? "라인 C" : "产线 C", assignee: lang === "ko" ? "박작업" : "朴作业", status: t("status.completed") },
  ];

  const headers = [
    t("workOrders.orderNo"), t("workOrders.productCode"), t("workOrders.designCode"),
    t("workOrders.qty"), t("workOrders.workDate"), t("workOrders.line"),
    t("workOrders.assignee"), t("workOrders.status"),
  ];

  return (
    <div>
      <PageHeader title={t("workOrders.title")} description={t("workOrders.desc")}>
        <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> {t("workOrders.create")}</Button>
      </PageHeader>
      <div className="p-6">
        <div className="kpi-card section-enter">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("workOrders.search")} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {headers.map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {workOrders.map((wo) => (
                  <tr key={wo.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                    <td className="py-2.5 font-medium text-primary pr-4">{wo.id}</td>
                    <td className="py-2.5 pr-4">{wo.product}</td>
                    <td className="py-2.5 pr-4">{wo.design}</td>
                    <td className="py-2.5 tabular-nums pr-4">{wo.qty.toLocaleString()}</td>
                    <td className="py-2.5 text-muted-foreground pr-4">{wo.date}</td>
                    <td className="py-2.5 pr-4">{wo.line}</td>
                    <td className="py-2.5 pr-4">{wo.assignee}</td>
                    <td className="py-2.5">
                      <span className={`status-badge ${
                        wo.status === t("status.inProgress") ? "status-running" :
                        wo.status === t("status.waiting") ? "status-idle" : "status-running"
                      }`}>{wo.status}</span>
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
