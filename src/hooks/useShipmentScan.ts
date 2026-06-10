import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useShipmentScan(orderId: string | undefined) {
  return useQuery({
    enabled: !!orderId,
    queryKey: ["shipment_scan", orderId],
    queryFn: async () => {
      const { data: shipment, error: e1 } = await supabase
        .from("shipments")
        .select(
          "id, order_id, carrier, tracking_number, status, scan_status, scanned_count, design_confirmed, tracking_issued_at, reported_at, orders(*)"
        )
        .eq("order_id", orderId!)
        .maybeSingle();
      if (e1) throw e1;
      if (!shipment) return null;

      const { data: items, error: e2 } = await supabase
        .from("shipment_scan_items")
        .select("*")
        .eq("shipment_id", shipment.id)
        .order("position", { ascending: true });
      if (e2) throw e2;

      return { shipment, items: items ?? [] };
    },
  });
}
