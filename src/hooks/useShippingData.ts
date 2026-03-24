import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type ShipmentStatus = Database["public"]["Enums"]["shipment_status"];

export interface ShippingFilters {
  status: ShipmentStatus | "all";
  search: string;
  page: number;
  pageSize: number;
}

export function useShippingGrouped(filters: ShippingFilters) {
  return useQuery({
    queryKey: ["shipping_grouped", filters],
    queryFn: async () => {
      // 1. Get orders that have shipments, with count
      let ordersQuery = supabase
        .from("orders")
        .select("id, external_order_id, product_code, recipient_name, quantity, created_at, project_completed_at, shipping_city, shipping_state")
        .order("created_at", { ascending: false });

      if (filters.search) {
        ordersQuery = ordersQuery.or(
          `external_order_id.ilike.%${filters.search}%,recipient_name.ilike.%${filters.search}%`
        );
      }

      const { data: orders, error: ordersError } = await ordersQuery;
      if (ordersError) throw ordersError;

      if (!orders || orders.length === 0) return { groups: [], totalOrders: 0 };

      // 2. Get all shipments for these orders
      const orderIds = orders.map(o => o.id);

      let shipmentsQuery = supabase
        .from("shipments")
        .select("*")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false });

      if (filters.status !== "all") {
        shipmentsQuery = shipmentsQuery.eq("status", filters.status);
      }

      const { data: shipments, error: shipmentsError } = await shipmentsQuery;
      if (shipmentsError) throw shipmentsError;

      // 3. Group shipments by order
      const shipmentsByOrder = new Map<string, typeof shipments>();
      for (const s of shipments ?? []) {
        const list = shipmentsByOrder.get(s.order_id) ?? [];
        list.push(s);
        shipmentsByOrder.set(s.order_id, list);
      }

      // 4. Build groups - only include orders that have shipments (or show all if no status filter)
      const groups = orders
        .filter(o => {
          if (filters.status !== "all") {
            return shipmentsByOrder.has(o.id);
          }
          return true;
        })
        .map((o, idx) => {
          const orderShipments = shipmentsByOrder.get(o.id) ?? [];
          const passCount = orderShipments.filter(s => s.inspect_result === "pass").length;
          const failCount = orderShipments.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result)).length;
          const pendingCount = orderShipments.filter(s => s.inspect_result === "pending").length;
          const shippedCount = orderShipments.filter(s => ["shipped", "in_transit", "delivered"].includes(s.status)).length;

          // Generate display order number based on created_at date
          const createdDate = new Date(o.created_at);
          const dateStr = `${createdDate.getFullYear()}${String(createdDate.getMonth() + 1).padStart(2, "0")}${String(createdDate.getDate()).padStart(2, "0")}`;

          return {
            orderId: o.id,
            displayOrder: `${dateStr}-${idx + 1}`,
            externalOrderId: o.external_order_id,
            recipientName: o.recipient_name,
            productCode: o.product_code,
            quantity: o.quantity,
            createdDate: o.created_at,
            dueDate: o.project_completed_at,
            shippingCity: o.shipping_city,
            shippingState: o.shipping_state,
            shipments: orderShipments,
            summary: { pass: passCount, fail: failCount, pending: pendingCount, shipped: shippedCount, total: orderShipments.length },
          };
        });

      const totalOrders = groups.length;
      const start = (filters.page - 1) * filters.pageSize;
      const paginatedGroups = groups.slice(start, start + filters.pageSize);

      return { groups: paginatedGroups, totalOrders };
    },
  });
}

export function useShippingKpis() {
  return useQuery({
    queryKey: ["shipping_kpis"],
    queryFn: async () => {
      const { data: shipments, error } = await supabase
        .from("shipments")
        .select("status, inspect_result");
      if (error) throw error;

      const shippedCount = shipments?.filter(s => ["shipped", "in_transit", "delivered"].includes(s.status)).length ?? 0;
      const pendingCount = shipments?.filter(s => s.status === "pending").length ?? 0;
      const passCount = shipments?.filter(s => s.inspect_result === "pass").length ?? 0;
      const failCount = shipments?.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result)).length ?? 0;

      return { shippedCount, pendingCount, passCount, failCount };
    },
  });
}
