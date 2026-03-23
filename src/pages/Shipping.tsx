import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Printer, Search } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

export default function Shipping() {
  const { t, lang } = useLang();

  const shipments = [
    { order: "ORD-24831", setId: "SET-20240315-0312", recipient: lang === "ko" ? "홍길동" : "洪吉童", phone: "010-****-5678", address: lang === "ko" ? "서울시 강남구 역삼동 123-4" : "首尔市江南区驿三洞123-4", product: "BT-2024-A", invoice: "CJ-123456789", status: "shipDone" },
    { order: "ORD-24832", setId: "SET-20240315-0311", recipient: lang === "ko" ? "김철수" : "金哲秀", phone: "010-****-1234", address: lang === "ko" ? "경기도 성남시 분당구 판교로 45" : "京畿道城南市盆唐区板桥路45", product: "BT-2024-A", invoice: "-", status: "invoiceWait" },
    { order: "ORD-24833", setId: "SET-20240315-0310", recipient: lang === "ko" ? "이영희" : "李英姬", phone: "010-****-9012", address: lang === "ko" ? "부산시 해운대구 우동 567" : "釜山市海云台区佑洞567", product: "BT-2024-B", invoice: "-", status: "shipHold" },
  ];

  const statusLabel: Record<string, string> = {
    invoiceWait: t("status.invoiceWait"), invoiceDone: t("status.invoiceDone"), shipDone: t("status.shipDone"), shipHold: t("status.shipHold"),
  };
  const statusBadge: Record<string, string> = {
    invoiceWait: "status-idle", invoiceDone: "status-warning", shipDone: "status-running", shipHold: "status-stopped",
  };

  const headers = [
    t("shipping.orderNo"), t("shipping.setId"), t("shipping.recipient"), t("shipping.phone"),
    t("shipping.address"), t("shipping.product"), t("shipping.invoiceNo"), t("shipping.status"), "",
  ];

  return (
    <div>
      <PageHeader title={t("shipping.title")} description={t("shipping.desc")}>
        <Button size="sm" variant="outline" className="gap-1.5"><Printer className="w-4 h-4" /> {t("shipping.batchPrint")}</Button>
      </PageHeader>
      <div className="p-6">
        <div className="kpi-card section-enter">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("shipping.search")} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">{headers.map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}</tr></thead>
              <tbody>
                {shipments.map((s) => (
                  <tr key={s.order} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 font-medium text-primary pr-4">{s.order}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{s.setId}</td>
                    <td className="py-2.5 pr-4">{s.recipient}</td>
                    <td className="py-2.5 text-muted-foreground pr-4">{s.phone}</td>
                    <td className="py-2.5 pr-4 max-w-[200px] truncate">{s.address}</td>
                    <td className="py-2.5 pr-4">{s.product}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{s.invoice}</td>
                    <td className="py-2.5 pr-4"><span className={`status-badge ${statusBadge[s.status]}`}>{statusLabel[s.status]}</span></td>
                    <td className="py-2.5">
                      {s.status === "invoiceWait" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Printer className="w-3 h-3" /> {t("shipping.print")}</Button>
                      )}
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
