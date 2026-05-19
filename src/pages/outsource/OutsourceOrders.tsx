import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { Search } from "lucide-react";

const mock = [
  { orderNo: "TM-2026-0001", serial: "000001", date: "2026-05-19", qty: 10, status: "신규" },
  { orderNo: "TM-2026-0002", serial: "000002", date: "2026-05-19", qty: 25, status: "발주대기" },
  { orderNo: "TM-2026-0003", serial: "000003", date: "2026-05-18", qty: 5, status: "발주완료" },
];

export default function OutsourceOrders() {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const filtered = mock.filter(m => !q || m.orderNo.includes(q));

  return (
    <div>
      <PageHeader title={t("menu.outOrders")} description={t("section.outsource")} />
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="p-4 flex gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t("out.orderNo")} value={q} onChange={e => setQ(e.target.value)} className="pl-8" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("out.orderNo")}</TableHead>
                  <TableHead>{t("out.serial")}</TableHead>
                  <TableHead>주문일자</TableHead>
                  <TableHead>{t("out.qty")}</TableHead>
                  <TableHead>{t("out.status")}</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(o => (
                  <TableRow key={o.orderNo}>
                    <TableCell className="font-mono">{o.orderNo}</TableCell>
                    <TableCell className="font-mono">{o.serial}</TableCell>
                    <TableCell>{o.date}</TableCell>
                    <TableCell>{o.qty}</TableCell>
                    <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => setDetail(o)}>{t("out.detail")}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{detail?.orderNo}</DialogTitle></DialogHeader>
          <pre className="text-xs bg-muted p-3 rounded overflow-auto">{JSON.stringify(detail, null, 2)}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
