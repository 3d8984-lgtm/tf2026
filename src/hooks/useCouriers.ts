import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CourierConfigRow {
  id: string;
  code: string;
  name: string;
  api_url: string;
  api_mode: string;
  enabled: boolean;
  is_default: boolean;
  has_credentials: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  sort_order: number;
}

export function useCouriers(onlyEnabled = false) {
  return useQuery({
    queryKey: ["courier_configs", onlyEnabled],
    queryFn: async () => {
      let q = supabase.from("courier_configs").select("*").order("sort_order", { ascending: true });
      if (onlyEnabled) q = q.eq("enabled", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CourierConfigRow[];
    },
  });
}

export function useSaveCourier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<CourierConfigRow> & { code: string; name: string }) => {
      const payload = {
        code: row.code,
        name: row.name,
        api_url: row.api_url ?? "",
        api_mode: row.api_mode ?? "test",
        enabled: row.enabled ?? false,
        is_default: row.is_default ?? false,
        sort_order: row.sort_order ?? 0,
      };
      const { error } = row.id
        ? await supabase.from("courier_configs").update(payload).eq("id", row.id)
        : await supabase.from("courier_configs").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courier_configs"] }),
  });
}

export function useDeleteCourier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("courier_configs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courier_configs"] }),
  });
}

async function courierConfigFn(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("courier-config", { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

export function useSaveCourierCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      code: string;
      api_key?: string;
      api_secret?: string;
      account_no?: string;
      extra?: Record<string, unknown>;
    }) => courierConfigFn({ action: "save_credentials", ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courier_configs"] }),
  });
}

export function useCourierExtra(code: string | null) {
  return useQuery({
    queryKey: ["courier_extra", code],
    enabled: !!code,
    queryFn: async () =>
      (await courierConfigFn({ action: "get_extra", code })) as {
        account_no: string;
        extra: Record<string, unknown>;
      },
  });
}

export function useClearCourierCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => courierConfigFn({ action: "clear_credentials", code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courier_configs"] }),
  });
}

export function useTestCourier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => courierConfigFn({ action: "test_connection", code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courier_configs"] }),
  });
}

export async function requestCarrierLabel(shipmentId: string, carrier: string, test = false) {
  const { data, error } = await supabase.functions.invoke("courier-label", {
    body: { shipment_id: shipmentId, carrier, test },
  });
  if (error) {
    const ctx = (error as any)?.context;
    let msg = error.message;
    try {
      const body = await ctx?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as {
    ok: boolean;
    carrier: string;
    tracking_number: string;
    label_url: string | null;
    test?: boolean;
    message?: string;
  };
}
