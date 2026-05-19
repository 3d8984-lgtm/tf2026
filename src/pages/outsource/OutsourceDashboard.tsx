import PageHeader from "@/components/PageHeader";
import KpiCard from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/contexts/LangContext";
import { Inbox, Send, CheckCircle2 } from "lucide-react";

const factories = [
  { key: "menu.outSilicon", pending: 3, done: 12 },
  { key: "menu.outHeatTransfer", pending: 5, done: 8 },
  { key: "menu.outHologram", pending: 2, done: 15 },
  { key: "menu.outNfcCard", pending: 4, done: 7 },
  { key: "menu.outLogo", pending: 1, done: 9 },
];

const recent = [
  { date: "2026-05-19 10:21", factory: "menu.outSilicon", orderNo: "TM-2026-0021", status: "완료" },
  { date: "2026-05-19 09:45", factory: "menu.outNfcCard", orderNo: "TM-2026-0020", status: "진행중" },
  { date: "2026-05-18 18:02", factory: "menu.outHologram", orderNo: "TM-2026-0019", status: "완료" },
];

export default function OutsourceDashboard() {
  const { t } = useLang();
  return (
    <div>
      <PageHeader title={t("menu.outDashboard")} description={t("section.outsource")} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard label={t("out.received")} value="42" icon={Inbox} />
          <KpiCard label={t("out.ordered")} value="31" icon={Send} />
          <KpiCard label={t("out.completed")} value="26" icon={CheckCircle2} />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">{t("out.factoryStatus")}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {factories.map(f => (
                <div key={f.key} className="rounded-md border p-4">
                  <p className="text-xs text-muted-foreground mb-2">{t(f.key)}</p>
                  <p className="text-2xl font-semibold">{f.pending + f.done}</p>
                  <p className="text-xs mt-1"><span className="text-warning">{f.pending} 대기</span> · <span className="text-success">{f.done} 완료</span></p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{t("out.recentOrders")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>일시</TableHead>
                  <TableHead>공장</TableHead>
                  <TableHead>{t("out.orderNo")}</TableHead>
                  <TableHead>{t("out.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm text-muted-foreground">{r.date}</TableCell>
                    <TableCell>{t(r.factory)}</TableCell>
                    <TableCell className="font-mono">{r.orderNo}</TableCell>
                    <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
