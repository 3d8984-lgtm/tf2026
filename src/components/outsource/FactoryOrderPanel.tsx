import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/contexts/LangContext";
import { Mail, Download, FileText, Eye } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export interface FactoryOrder {
  orderNo: string;
  serial: string;
  qty: number;
  status: string;
}

interface Props {
  /** primary action key like 'out.generatePdf' */
  generateLabelKey: string;
  /** download label key */
  downloadLabelKey?: string;
  /** Extra columns appended after qty */
  extraColumns?: { header: string; render: (o: FactoryOrder) => React.ReactNode }[];
  /** Sample data */
  orders: FactoryOrder[];
  /** Preview content shown after generate */
  renderPreview?: (selected: FactoryOrder[]) => React.ReactNode;
}

export default function FactoryOrderPanel({
  generateLabelKey,
  downloadLabelKey = "out.download",
  extraColumns = [],
  orders,
  renderPreview,
}: Props) {
  const { t } = useLang();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generated, setGenerated] = useState(false);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    setSelected(selected.size === orders.length ? new Set() : new Set(orders.map(o => o.orderNo)));
  };

  const selectedOrders = orders.filter(o => selected.has(o.orderNo));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("out.orderList")}</CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={() => {
                setGenerated(true);
                toast({ title: t(generateLabelKey), description: `${selected.size} ${t("out.qty")}` });
              }}
            >
              <FileText className="w-4 h-4 mr-1" /> {t(generateLabelKey)}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selected.size === orders.length && orders.length > 0} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>{t("out.orderNo")}</TableHead>
                <TableHead>{t("out.serial")}</TableHead>
                <TableHead>{t("out.qty")}</TableHead>
                {extraColumns.map((c, i) => <TableHead key={i}>{c.header}</TableHead>)}
                <TableHead>{t("out.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map(o => (
                <TableRow key={o.orderNo}>
                  <TableCell><Checkbox checked={selected.has(o.orderNo)} onCheckedChange={() => toggle(o.orderNo)} /></TableCell>
                  <TableCell className="font-mono">{o.orderNo}</TableCell>
                  <TableCell className="font-mono">{o.serial}</TableCell>
                  <TableCell>{o.qty}</TableCell>
                  {extraColumns.map((c, i) => <TableCell key={i}>{c.render(o)}</TableCell>)}
                  <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {generated && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Eye className="w-4 h-4" /> {t("out.preview")}</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => toast({ title: t("out.sendEmail") })}>
                <Mail className="w-4 h-4 mr-1" /> {t("out.sendEmail")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => toast({ title: t(downloadLabelKey) })}>
                <Download className="w-4 h-4 mr-1" /> {t(downloadLabelKey)}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {renderPreview ? renderPreview(selectedOrders) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                {selectedOrders.length} {t("out.qty")} · {t("out.preview")}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const sampleOrders: FactoryOrder[] = [
  { orderNo: "TM-2026-0001", serial: "000001", qty: 10, status: "대기" },
  { orderNo: "TM-2026-0002", serial: "000002", qty: 25, status: "대기" },
  { orderNo: "TM-2026-0003", serial: "000003", qty: 5, status: "대기" },
];
