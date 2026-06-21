import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Address book = recipients pulled from orders that were ingested via the
 * "주문 데이터 가져오기" menu (Webhook or Excel — i.e. linked to an
 * upload_history record). Reported shipments are excluded.
 */
export function useAddressBook(_currentOrderId?: string) {
  return useQuery({
    queryKey: ["address_book"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, external_order_id, recipient_name, recipient_phone, shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country, quantity, project_completed_at, upload_history_id, shipments(id, scan_status, tracking_number, scanned_count, carrier)"
        )
        .not("upload_history_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).filter((o: any) => {
        const s = o.shipments?.[0];
        return !s || s.scan_status !== "reported";
      });
    },
    refetchOnWindowFocus: false,
  });
}
