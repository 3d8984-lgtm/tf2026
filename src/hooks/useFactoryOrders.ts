import { useMemo } from "react";
import { useOrders } from "@/hooks/useDbData";
import type { FactoryOrder } from "@/components/outsource/FactoryOrderPanel";

/**
 * Build FactoryOrder[] from the orders table.
 * - orderNo = external_order_id (작업번호)
 * - one row per item in source_data.items, fallback to a single row
 */
export function useFactoryOrders() {
  const { data, isLoading } = useOrders();

  const orders: FactoryOrder[] = useMemo(() => {
    const out: FactoryOrder[] = [];
    for (const o of (data || []) as any[]) {
      const items: Record<string, string>[] = (o.source_data?.items as any) || [];
      if (items.length === 0) {
        out.push({
          orderNo: o.external_order_id,
          serial: `${o.id}:0`,
          qty: o.quantity || 1,
          status: o.status || "received",
        });
      } else {
        items.forEach((it, idx) => {
          out.push({
            orderNo: o.external_order_id,
            serial: it.sequence_no || `${idx + 1}`,
            qty: 1,
            status: o.status || "received",
          });
        });
      }
    }
    return out;
  }, [data]);

  const logoByOrderNo = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const o of (data || []) as any[]) {
      map[o.external_order_id] = o.logo_url ?? null;
    }
    return map;
  }, [data]);

  return { orders, logoByOrderNo, isLoading };
}
