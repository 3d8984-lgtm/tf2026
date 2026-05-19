import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLang } from "@/contexts/LangContext";
import { Mail, Download, FileText, Eye, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export interface FactoryOrder {
  orderNo: string;
  serial: string;
  qty: number;
  status: string;
}

interface Props {
  generateLabelKey: string;
  downloadLabelKey?: string;
  extraColumns?: { header: string; render: (o: FactoryOrder) => React.ReactNode }[];
  orders: FactoryOrder[];
  renderPreview?: (selected: FactoryOrder[]) => React.ReactNode;
}

export default function FactoryOrderPanel({
  generateLabelKey,
  downloadLabelKey = "out.download",
  extraColumns = [],
  orders: initialOrders,
  renderPreview,
}: Props) {
  const { t } = useLang();
  const [orders, setOrders] = useState<FactoryOrder[]>(initialOrders);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generated, setGenerated] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    setSelected(selected.size === orders.length ? new Set() : new Set(orders.map(o => o.orderNo)));
  };

  const selectedOrders = orders.filter(o => selected.has(o.orderNo));

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const ids = new Set(pendingDelete);
    setOrders(prev => prev.filter(o => !ids.has(o.orderNo)));
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
    toast({ title: t("out.deleted"), description: `${pendingDelete.length} ${t("out.qty")}` });
    setPendingDelete(null);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("out.orderList")}</CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={selected.size === 0}
              onClick={() => setPendingDelete(Array.from(selected))}
            >
              <Trash2 className="w-4 h-4 mr-1" /> {t("out.deleteSelected")}
            </Button>
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
                <TableHead className="w-16 text-right">{t("out.action")}</TableHead>
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
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPendingDelete([o.orderNo])}
                      aria-label={t("out.delete")}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6 + extraColumns.length} className="text-center text-sm text-muted-foreground py-8">
                    —
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {generated && selectedOrders.length > 0 && (
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

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("out.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("out.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("out.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t("out.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const sampleOrders: FactoryOrder[] = [
  { orderNo: "TM-2026-0001", serial: "000001", qty: 10, status: "대기" },
  { orderNo: "TM-2026-0002", serial: "000002", qty: 25, status: "대기" },
  { orderNo: "TM-2026-0003", serial: "000003", qty: 5, status: "대기" },
];
