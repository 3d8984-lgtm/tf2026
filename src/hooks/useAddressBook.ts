import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Address book = list of shipments that are not yet reported,
 * shown alongside the QR scan screen so workers can quickly switch
 * between recipients / addresses.
 */
export function useAddressBook(currentOrderId?: string) {
  return useQuery({
    queryKey: ["address_book"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select(
          "id, order_id, scan_status, tracking_number, scanned_count, orders(external_order_id, recipient_name, recipient_phone, shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country, quantity, project_completed_at)"
        )
        .neq("scan_status", "reported")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
    refetchOnWindowFocus: false,
  });
}
