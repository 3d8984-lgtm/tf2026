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
import { Search, Trash2, Loader2, ChevronLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOrders } from "@/hooks/useDbData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface ItemRow {
  rowKey: string;
  orderId: string;
  orderNo: string;
  serial: string;
  date: string;
  qty: number;
  status: string;
  item: Record<string, string>;
}

const IMPORT_COLUMNS: { key: string; label: string; type?: "url" }[] = [
  { key: "order_id", label: "개별 주문번호" },
  { key: "twinker_name", label: "트윈커" },
  { key: "issued_no", label: "ISSUED No." },
  { key: "minted_on", label: "Minted on" },
  { key: "grade", label: "카드등급" },
  { key: "edition", label: "에디션" },
  { key: "tshirt_type", label: "티셔츠 종류" },
  { key: "tshirt_color", label: "색상" },
  { key: "tshirt_size", label: "사이즈" },
  { key: "nfc_ndef_data", label: "NFC NDEF" },
  { key: "cp_value", label: "CP 점수" },
  { key: "country_code", label: "국가" },
  { key: "recipient_name", label: "수령인" },
  { key: "recipient_phone", label: "전화번호" },
  { key: "shipping_address", label: "주소" },
  { key: "shipping_zip", label: "우편번호" },
  { key: "ship_date", label: "배송일" },
  { key: "twinker_logo_url", label: "로고", type: "url" },
  { key: "twincode_svg_url", label: "트윈코드 SVG", type: "url" },
  { key: "sign_url", label: "사인", type: "url" },
  { key: "gft_original_image_url", label: "디자인", type: "url" },
];

function displayValue(value?: string | null) {
  const v = String(value ?? "").trim();
  return v || "—";
}

function ImportCell({ row, column }: { row: ItemRow; column: (typeof IMPORT_COLUMNS)[number] }) {
  const raw = row.item?.[column.key] || (column.key === "order_id" ? row.serial : "");
  const value = displayValue(raw);
  if (column.type === "url" && raw && /^https?:\/\//i.test(raw)) {
    return (
      <a href={raw} target="_blank" rel="noreferrer" className="text-primary hover:underline">
        보기
      </a>
    );
  }
  return <span>{value}</span>;
}

interface OrderGroup {
  orderId: string;        // db uuid
  orderNo: string;        // external_order_id (작업번호)
  date: string;
  status: string;
  itemCount: number;
  totalQty: number;
  rows: ItemRow[];
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
    orderSerialNo: i.order_id || row.serial || row.orderNo,
    twinCodeSvg: i.twincode_svg_url || null,
    designPng: i.design_png_url || i.gft_original_image_url || null,
    cpValue: i.cp_value || null,
    sequenceNo: i.sequence_no || row.serial || null,
    twinCodePng: i.twincode_png_url || null,
    dmBarcodePng: i.dm_barcode_png_url || null,
    edition: i.edition || null,
    mintedOn: i.minted_on || null,
    grade: i.grade || null,
    signPng: i.sign_png_url || i.sign_url || null,
    cardFrontDesignPng: i.card_front_png_url || i.gft_original_image_url || null,
    cardBackDesignPng: i.card_back_png_url || null,
    logoPng: i.logo_png_url || i.twinker_logo_url || null,
  };
}

export default function OutsourceOrders() {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const { data: ordersData, isLoading } = useOrders();
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<ItemRow | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ orderIds: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Group orders by work number (one DB order = one 작업번호)
  // Only show orders linked via "주문 데이터 가져오기" (have upload_history_id)
  const groups: OrderGroup[] = useMemo(() => {
    const out: OrderGroup[] = [];
    for (const o of (ordersData || []) as any[]) {
      if (!o.upload_history_id) continue;
      const items: Record<string, string>[] = (o.source_data?.items as any) || [];
      const date = fmtDate(o.created_at);
      const rows: ItemRow[] = items.length === 0
        ? [{
            rowKey: `${o.id}:0`,
            orderId: o.id,
            orderNo: o.external_order_id,
            serial: o.product_code || "",
            date,
            qty: o.quantity || 1,
            status: o.status || "received",
            item: {},
          }]
        : items.map((it, idx) => ({
            rowKey: `${o.id}:${idx}`,
            orderId: o.id,
            orderNo: o.external_order_id,
            serial: it.sequence_no || `${idx + 1}`,
            date,
            qty: 1,
            status: o.status || "received",
            item: it,
          }));
      out.push({
        orderId: o.id,
        orderNo: o.external_order_id,
        date,
        status: o.status || "received",
        itemCount: rows.length,
        totalQty: o.quantity || rows.length,
        rows,
      });
    }
    return out;
  }, [ordersData]);

  const activeGroup = useMemo(
    () => groups.find(g => g.orderId === activeGroupId) || null,
    [groups, activeGroupId],
  );

  const filteredGroups = groups.filter(
    g => !q || g.orderNo.toLowerCase().includes(q.toLowerCase()),
  );
  const filteredItems = activeGroup
    ? activeGroup.rows.filter(
        r => !q || r.serial.toLowerCase().includes(q.toLowerCase()),
      )
    : [];

  const toggleGroup = (id: string) => {
    const next = new Set(selectedGroups);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedGroups(next);
  };
  const toggleAllGroups = () => {
    setSelectedGroups(
      selectedGroups.size === filteredGroups.length
        ? new Set()
        : new Set(filteredGroups.map(g => g.orderId)),
    );
  };
  const toggleItem = (id: string) => {
    const next = new Set(selectedItems);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedItems(next);
  };

  const requestDeleteGroups = (orderIds: string[]) => {
    setPendingDelete({ orderIds });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("orders").delete().in("id", pendingDelete.orderIds);
      if (error) throw error;
      setSelectedGroups(prev => {
        const next = new Set(prev);
        pendingDelete.orderIds.forEach(id => next.delete(id));
        return next;
      });
      // if currently viewing a deleted group, go back
      if (activeGroupId && pendingDelete.orderIds.includes(activeGroupId)) {
        setActiveGroupId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order_stats"] });
      toast({ title: t("out.deleted"), description: `${pendingDelete.orderIds.length}` });
      setPendingDelete(null);
    } catch (e: any) {
      console.error(e);
      toast({ title: "삭제 실패", description: e?.message || "", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  // === Detail page (item list within a 작업번호) ===
  if (activeGroup) {
    return (
      <div>
        <PageHeader title={`${t("menu.outOrders")} · ${activeGroup.orderNo}`} description={t("section.outsource")} />
        <div className="p-6 space-y-4">
          <Card>
            <CardContent className="p-4 flex gap-2 items-center justify-between">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setActiveGroupId(null); setSelectedItems(new Set()); setQ(""); }}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> 목록으로
                </Button>
                <div className="text-sm text-muted-foreground">
                  작업번호 <span className="font-mono text-foreground">{activeGroup.orderNo}</span> · {activeGroup.itemCount}건
                </div>
              </div>
              <div className="relative w-64">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder={t("out.serial")} value={q} onChange={e => setQ(e.target.value)} className="pl-8" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {IMPORT_COLUMNS.map((column) => (
                      <TableHead key={column.key} className="whitespace-nowrap">
                        {column.label}
                      </TableHead>
                    ))}
                    <TableHead>{t("out.status")}</TableHead>
                    <TableHead className="w-32 text-right sticky right-0 bg-card">{t("out.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map(r => (
                    <TableRow key={r.rowKey}>
                      {IMPORT_COLUMNS.map((column) => (
                        <TableCell key={column.key} className="whitespace-nowrap max-w-72 truncate">
                          <ImportCell row={r} column={column} />
                        </TableCell>
                      ))}
                      <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                      <TableCell className="text-right sticky right-0 bg-card">
                        <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>{t("out.detail")}</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={IMPORT_COLUMNS.length + 2} className="text-center text-sm text-muted-foreground py-8">—</TableCell>
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
      </div>
    );
  }

  // === List page (groups by 작업번호) ===
  return (
    <div>
      <PageHeader title={t("menu.outOrders")} description={t("section.outsource")} />
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="p-4 flex gap-2 items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="작업번호" value={q} onChange={e => setQ(e.target.value)} className="pl-8" />
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={selectedGroups.size === 0}
              onClick={() => requestDeleteGroups(Array.from(selectedGroups))}
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
                    <Checkbox
                      checked={selectedGroups.size === filteredGroups.length && filteredGroups.length > 0}
                      onCheckedChange={toggleAllGroups}
                    />
                  </TableHead>
                  <TableHead>작업번호</TableHead>
                  <TableHead>주문일자</TableHead>
                  <TableHead>주문 건수</TableHead>
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
                {!isLoading && filteredGroups.map(g => (
                  <TableRow key={g.orderId}>
                    <TableCell>
                      <Checkbox checked={selectedGroups.has(g.orderId)} onCheckedChange={() => toggleGroup(g.orderId)} />
                    </TableCell>
                    <TableCell>
                      <button
                        className="font-mono text-primary hover:underline"
                        onClick={() => { setActiveGroupId(g.orderId); setQ(""); }}
                      >
                        {g.orderNo}
                      </button>
                    </TableCell>
                    <TableCell>{g.date}</TableCell>
                    <TableCell>{g.itemCount}</TableCell>
                    <TableCell>{g.totalQty}</TableCell>
                    <TableCell><Badge variant="outline">{g.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => { setActiveGroupId(g.orderId); setQ(""); }}>
                        주문 보기
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => requestDeleteGroups([g.orderId])}
                        aria-label={t("out.delete")}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && filteredGroups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">—</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

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
