import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Search, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Row {
  orderNo: string;
  serial: string;
  date: string;
  qty: number;
  status: string;
}

const initial: Row[] = [
  { orderNo: "TM-2026-0001", serial: "000001", date: "2026-05-19", qty: 10, status: "신규" },
  { orderNo: "TM-2026-0002", serial: "000002", date: "2026-05-19", qty: 25, status: "발주대기" },
  { orderNo: "TM-2026-0003", serial: "000003", date: "2026-05-18", qty: 5, status: "발주완료" },
];

export default function OutsourceOrders() {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>(initial);
  const [detail, setDetail] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);

  const filtered = rows.filter(m => !q || m.orderNo.includes(q));

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(r => r.orderNo)));
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const ids = new Set(pendingDelete);
    setRows(prev => prev.filter(r => !ids.has(r.orderNo)));
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
    toast({ title: t("out.deleted"), description: `${pendingDelete.length} ${t("out.qty")}` });
    setPendingDelete(null);
  };

  return (
    <div>
      <PageHeader title={t("menu.outOrders")} description={t("section.outsource")} />
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="p-4 flex gap-2 items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t("out.orderNo")} value={q} onChange={e => setQ(e.target.value)} className="pl-8" />
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={selected.size === 0}
              onClick={() => setPendingDelete(Array.from(selected))}
            >
              <Trash2 className="w-4 h-4 mr-1" /> {t("out.deleteSelected")}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>{t("out.orderNo")}</TableHead>
                  <TableHead>{t("out.serial")}</TableHead>
                  <TableHead>주문일자</TableHead>
                  <TableHead>{t("out.qty")}</TableHead>
                  <TableHead>{t("out.status")}</TableHead>
                  <TableHead className="w-32 text-right">{t("out.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(o => (
                  <TableRow key={o.orderNo}>
                    <TableCell><Checkbox checked={selected.has(o.orderNo)} onCheckedChange={() => toggle(o.orderNo)} /></TableCell>
                    <TableCell className="font-mono">{o.orderNo}</TableCell>
                    <TableCell className="font-mono">{o.serial}</TableCell>
                    <TableCell>{o.date}</TableCell>
                    <TableCell>{o.qty}</TableCell>
                    <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(o)}>{t("out.detail")}</Button>
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
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">—</TableCell>
                  </TableRow>
                )}
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
