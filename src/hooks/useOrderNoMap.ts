import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Maps order id → displayed order number (YYYYMMDD-<daily sequence>),
 * matching the numbering used by the t-shirt attach workstation and the
 * QR master sync trigger.
 */
export function useOrderNoMap() {
  return useQuery({
    queryKey: ["order_no_map"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, created_at")
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      const counters: Record<string, number> = {};
      const map: Record<string, string> = {};
      for (const o of data ?? []) {
        const d = new Date(o.created_at as string);
        const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
        counters[key] = (counters[key] || 0) + 1;
        map[o.id as string] = `${key}-${counters[key]}`;
      }
      return map;
    },
  });
}
