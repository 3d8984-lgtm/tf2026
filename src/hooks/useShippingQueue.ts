import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ScanStatus = Database["public"]["Enums"]["scan_status"];

export interface QueueFilters {
  status: ScanStatus | "all";
  search: string;
}

export function useShippingQueue(filters: QueueFilters) {
  return useQuery({
    queryKey: ["shipping_queue", filters],
    queryFn: async () => {
      let q = supabase
        .from("shipments")
        .select(
          "id, order_id, carrier, tracking_number, status, scan_status, scanned_count, design_confirmed, tracking_issued_at, reported_at, created_at, orders(external_order_id, recipient_name, recipient_phone, shipping_address, shipping_city, shipping_state, shipping_zip, product_code, design_code, quantity, project_completed_at, logo_url)"
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (filters.status !== "all") q = q.eq("scan_status", filters.status);
      const { data, error } = await q;
      if (error) throw error;
      const list = data ?? [];
      const term = filters.search.trim().toLowerCase();
      if (!term) return list;
      return list.filter(
        (r: any) =>
          r.orders?.external_order_id?.toLowerCase().includes(term) ||
          r.orders?.recipient_name?.toLowerCase().includes(term) ||
          r.tracking_number?.toLowerCase().includes(term)
      );
    },
  });
}

export function useShippingQueueKpis() {
  return useQuery({
    queryKey: ["shipping_queue_kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shipments").select("scan_status");
      if (error) throw error;
      const c = (s: ScanStatus) => data?.filter((r) => r.scan_status === s).length ?? 0;
      return {
        pending: c("pending"),
        scanning: c("scanning"),
        ready: c("ready"),
        shipped: c("shipped"),
        reported: c("reported"),
        total: data?.length ?? 0,
      };
    },
  });
}
