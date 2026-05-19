import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import OrderDetailModal, { OrderDetailData } from "@/components/outsource/OrderDetailModal";
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
import { Search, Trash2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOrders } from "@/hooks/useDbData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface ItemRow {
  rowKey: string;          // unique row id (orderId + itemIndex)
  orderId: string;         // db uuid
  orderNo: string;         // external_order_id (작업번호)
  serial: string;          // item serial (sequence_no) — fallback to product_code/index
  date: string;            // created_at (YYYY-MM-DD)
  qty: number;             // 1 per item
  status: string;
  item: Record<string, string>;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return String(iso).slice(0, 10);
  }
}

function buildDetailData(row: ItemRow): OrderDetailData {
  const i = row.item || {};
  return {
    orderSerialNo: row.serial || row.orderNo,
    twinCodeSvg: i.twincode_svg_url || null,
    designPng: i.design_png_url || null,
    cpValue: i.cp_value || null,
    sequenceNo: i.sequence_no || row.serial || null,
    twinCodePng: i.twincode_png_url || null,
    dmBarcodePng: i.dm_barcode_png_url || null,
    edition: i.edition || null,
    mintedOn: i.minted_on || null,
    grade: i.grade || null,
    signPng: i.sign_png_url || null,
    cardFrontDesignPng: i.card_front_png_url || null,
    cardBackDesignPng: i.card_back_png_url || null,
    logoPng: i.logo_png_url || null,
  };
}

export default function OutsourceOrders() {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const { data: ordersData, isLoading } = useOrders();
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<ItemRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<{ rowKeys: string[]; orderIds: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Expand each order into per-item rows
  const rows: ItemRow[] = useMemo(() => {
    const out: ItemRow[] = [];
    for (const o of (ordersData || []) as any[]) {
      const items: Record<string, string>[] = (o.source_data?.items as any) || [];
      const date = fmtDate(o.created_at);
      if (items.length === 0) {
        out.push({
          rowKey: `${o.id}:0`,
          orderId: o.id,
          orderNo: o.external_order_id,
          serial: o.product_code || "",
          date,
          qty: o.quantity || 1,
          status: o.status || "received",
          item: {},
        });
      } else {
        items.forEach((it, idx) => {
          out.push({
            rowKey: `${o.id}:${idx}`,
            orderId: o.id,
            orderNo: o.external_order_id,
            serial: it.sequence_no || `${idx + 1}`,
            date,
            qty: 1,
            status: o.status || "received",
            item: it,
          });
        });
      }
    }
    return out;
  }, [ordersData]);

  const filtered = rows.filter(m => !q || m.orderNo.toLowerCase().includes(q.toLowerCase()) || m.serial.toLowerCase().includes(q.toLowerCase()));

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(r => r.rowKey)));
  };

  const requestDelete = (rowKeys: string[]) => {
    const orderIds = Array.from(
      new Set(
        rowKeys
          .map(k => rows.find(r => r.rowKey === k)?.orderId)
          .filter(Boolean) as string[],
      ),
    );
    setPendingDelete({ rowKeys, orderIds });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("orders").delete().in("id", pendingDelete.orderIds);
      if (error) throw error;
      const removedKeys = new Set(pendingDelete.rowKeys);
      setSelected(prev => {
        const next = new Set(prev);
        removedKeys.forEach(k => next.delete(k));
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order_stats"] });
      toast({ title: t("out.deleted"), description: `${pendingDelete.orderIds.length} ${t("out.qty")}` });
      setPendingDelete(null);
    } catch (e: any) {
      console.error(e);
      toast({ title: "삭제 실패", description: e?.message || "", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
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
              onClick={() => requestDelete(Array.from(selected))}
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
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin inline" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.map(o => (
                  <TableRow key={o.rowKey}>
                    <TableCell><Checkbox checked={selected.has(o.rowKey)} onCheckedChange={() => toggle(o.rowKey)} /></TableCell>
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
                        onClick={() => requestDelete([o.rowKey])}
                        aria-label={t("out.delete")}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">—</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <OrderDetailModal
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        data={detail ? buildDetailData(detail) : null}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("out.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("out.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("out.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("out.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
