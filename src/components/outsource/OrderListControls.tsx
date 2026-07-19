import { useEffect, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  getOrderStatus,
  type FactoryKey,
  type OrderShippingStatus,
} from "@/hooks/useOrderStatus";

const EVENT = "order-shipping-status:changed";

export type OrderListSort = "newest" | "dueSoon";
export type OrderListStatusFilter = "all" | OrderShippingStatus;

export interface OrderListRow {
  orderNo: string;
  receivedAt?: string; // yyyy-mm-dd
  dueDate?: string;    // yyyy-mm-dd
}

function parseDate(s?: string): number {
  if (!s) return NaN;
  const t = new Date(s).getTime();
  return isNaN(t) ? NaN : t;
}

export function useOrderListControls<T extends OrderListRow>(
  factory: FactoryKey,
  rows: T[],
) {
  const [sortBy, setSortBy] = useState<OrderListSort>("newest");
  const [statusFilter, setStatusFilter] = useState<OrderListStatusFilter>("all");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const sync = () => setTick(v => v + 1);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const withStatus = useMemo(
    () => rows.map(r => ({ row: r, status: getOrderStatus(factory, r.orderNo) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, factory, tick],
  );

  const counts = useMemo(() => {
    const c = { pending: 0, hold: 0, completed: 0, total: rows.length };
    for (const x of withStatus) c[x.status]++;
    return c;
  }, [withStatus, rows.length]);

  const processed = useMemo(() => {
    const filtered = statusFilter === "all"
      ? withStatus
      : withStatus.filter(x => x.status === statusFilter);

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "dueSoon") {
        const da = parseDate(a.row.dueDate);
        const db = parseDate(b.row.dueDate);
        const aValid = !isNaN(da);
        const bValid = !isNaN(db);
        if (aValid && bValid) return da - db;
        if (aValid) return -1;
        if (bValid) return 1;
      }
      // newest first (default / fallback)
      const ra = parseDate(a.row.receivedAt);
      const rb = parseDate(b.row.receivedAt);
      if (!isNaN(ra) && !isNaN(rb)) return rb - ra;
      return 0;
    });
    return sorted.map(x => x.row);
  }, [withStatus, statusFilter, sortBy]);

  return { sortBy, setSortBy, statusFilter, setStatusFilter, counts, processed };
}

interface BarProps {
  sortBy: OrderListSort;
  setSortBy: (v: OrderListSort) => void;
  statusFilter: OrderListStatusFilter;
  setStatusFilter: (v: OrderListStatusFilter) => void;
  counts: { pending: number; hold: number; completed: number; total: number };
}

export function OrderListControlsBar({
  sortBy, setSortBy, statusFilter, setStatusFilter, counts,
}: BarProps) {
  return (
    <div className="flex items-center flex-wrap gap-2">
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">정렬</Label>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as OrderListSort)}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">최신 주문순</SelectItem>
            <SelectItem value="dueSoon">납기일 임박순</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">발주 상태</Label>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as OrderListStatusFilter)}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 ({counts.total})</SelectItem>
            <SelectItem value="pending">미발주 ({counts.pending})</SelectItem>
            <SelectItem value="hold">보류 ({counts.hold})</SelectItem>
            <SelectItem value="completed">발주완료 ({counts.completed})</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function OrderStatusCountsBadges({
  counts,
}: { counts: { pending: number; hold: number; completed: number } }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <Badge variant="outline" className="text-muted-foreground">미발주 {counts.pending}</Badge>
      <Badge variant="outline" className="text-amber-600 border-amber-500/40">보류 {counts.hold}</Badge>
      <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">발주완료 {counts.completed}</Badge>
    </div>
  );
}
