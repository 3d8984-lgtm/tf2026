import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useProductionTracking() {
  return useQuery({
    queryKey: ["production_tracking"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_tracking")
        .select("*, orders(external_order_id, product_code, design_code, quantity)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useShipments() {
  return useQuery({
    queryKey: ["shipments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("*, orders(external_order_id, product_code, design_code, recipient_name, recipient_phone, shipping_address, shipping_city, shipping_state, shipping_zip)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useOrderStats() {
  return useQuery({
    queryKey: ["order_stats"],
    queryFn: async () => {
      const { data: orders } = await supabase.from("orders").select("status, quantity");
      const { data: tracking } = await supabase.from("production_tracking").select("stage, completed_count");
      const { data: shipments } = await supabase.from("shipments").select("status, inspect_result");

      const totalOrders = orders?.length ?? 0;
      const totalQty = orders?.reduce((s, o) => s + o.quantity, 0) ?? 0;

      const prodDone = tracking
        ?.filter(t => t.stage === "tshirt")
        .reduce((s, t) => s + t.completed_count, 0) ?? 0;

      const setDone = tracking
        ?.filter(t => t.stage === "set")
        .reduce((s, t) => s + t.completed_count, 0) ?? 0;

      const shipDone = shipments
        ?.filter(s => ["shipped", "in_transit", "delivered"].includes(s.status))
        .length ?? 0;

      const errors = shipments
        ?.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result))
        .length ?? 0;

      return { totalOrders, totalQty, prodDone, setDone, shipDone, errors };
    },
  });
}
