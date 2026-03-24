import React, { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";

export default function WorkOrders() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [search, setSearch] = useState("");

  const { data: orders, isLoading } = useOrders();

  const statusBadge = (status: string) => {
    switch (status) {
      case "received": return { label: t("status.waiting"), cls: "status-idle" };
      case "in_production": return { label: t("status.inProgress"), cls: "status-running" };
      case "completed": return { label: t("status.completed"), cls: "status-running" };
      case "shipped": return { label: t("status.shipDone"), cls: "status-running" };
      case "cancelled": return { label: isKo ? "취소" : "已取消", cls: "status-stopped" };
      default: return { label: status, cls: "status-idle" };
    }
  };

  const filtered = orders?.filter(wo =>
    !search ||
    wo.external_order_id.toLowerCase().includes(search.toLowerCase()) ||
    wo.product_code.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const headers = [
    t("workOrders.orderNo"), t("workOrders.productCode"), t("workOrders.designCode"),
    t("workOrders.qty"), isKo ? "수취인" : "收件人",
    isKo ? "배송지" : "配送地址", t("workOrders.status"),
  ];

  return (
    <div>
      <PageHeader title={t("workOrders.title")} description={t("workOrders.desc")}>
        <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> {t("workOrders.create")}</Button>
      </PageHeader>
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: isKo ? "전체" : "全部", value: orders?.length ?? 0 },
            { label: t("status.waiting"), value: orders?.filter(o => o.status === "received").length ?? 0 },
            { label: t("status.inProgress"), value: orders?.filter(o => o.status === "in_production").length ?? 0 },
            { label: t("status.completed"), value: orders?.filter(o => o.status === "completed").length ?? 0 },
            { label: t("status.shipDone"), value: orders?.filter(o => o.status === "shipped").length ?? 0 },
          ].map((s, i) => (
            <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
              <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="kpi-card section-enter" style={{ animationDelay: "80ms" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("workOrders.search")} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    {headers.map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(wo => {
                    const sb = statusBadge(wo.status);
                    return (
                      <tr key={wo.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 font-medium text-primary pr-4">{wo.external_order_id}</td>
                        <td className="py-2.5 pr-4">{wo.product_code}</td>
                        <td className="py-2.5 pr-4">{wo.design_code ?? "-"}</td>
                        <td className="py-2.5 tabular-nums pr-4">{wo.quantity.toLocaleString()}</td>
                        <td className="py-2.5 pr-4">{wo.recipient_name}</td>
                        <td className="py-2.5 pr-4 max-w-[200px] truncate text-muted-foreground">
                          {[wo.shipping_city, wo.shipping_state, wo.shipping_country].filter(Boolean).join(", ")}
                        </td>
                        <td className="py-2.5 pr-4"><span className={`status-badge ${sb.cls}`}>{sb.label}</span></td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={headers.length} className="py-8 text-center text-muted-foreground">{isKo ? "주문이 없습니다" : "暂无订单"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
