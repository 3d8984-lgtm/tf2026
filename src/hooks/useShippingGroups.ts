import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LabelStatus = "pending" | "issuing" | "ready" | "failed";

export interface ShippingGroupRow {
  id: string;
  group_key: string;
  recipient_name: string;
  recipient_phone: string;
  shipping_address: string;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string;
  shipping_country: string;
  item_count: number;
  required_scan_count: number;
  scanned_count: number;
  carrier: string | null;
  tracking_number: string | null;
  label_url: string | null;
  ref_no: string | null;
  label_status: LabelStatus;
  label_error: string | null;
  label_issued_at: string | null;
  printed_at: string | null;
  scan_status: string;
}

/** (Re)builds shipping groups from the scan items of the given orders. Idempotent. */
export async function buildShippingGroups(orderIds?: string[]) {
  const { data, error } = await supabase.functions.invoke("shipping-groups-build", {
    body: orderIds?.length ? { order_ids: orderIds } : {},
  });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { ok: boolean; groups: number; linked: number };
}

/** Issues (or re-tries) the waybill of ONE shipping group. Idempotent server-side. */
export async function issueGroupLabel(groupId: string, carrier: string) {
  const { data, error } = await supabase.functions.invoke("courier-label", {
    body: { shipping_group_id: groupId, carrier },
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
  return data as { ok: boolean; tracking_number: string; label_url: string | null; already?: boolean };
}

/** Limited-concurrency queue so we never flood the carrier API. */
export async function issueGroupLabels(
  groups: { id: string; recipient_name: string }[],
  carrier: string,
  opts: {
    concurrency?: number;
    onProgress?: (p: { done: number; total: number; success: number; failed: number; last?: { id: string; name: string; ok: boolean; message?: string } }) => void;
  } = {},
) {
  // YunExpress authentication applies to the whole account. Keep its queue
  // sequential so one terminal credential error cannot create many identical
  // failed requests at once.
  const concurrency = carrier === "yunexpress"
    ? 1
    : Math.min(Math.max(opts.concurrency ?? 6, 1), 10);
  const total = groups.length;
  let cursor = 0;
  let done = 0;
  let success = 0;
  let failed = 0;
  const results: { id: string; ok: boolean; message?: string; tracking_number?: string }[] = [];
  let terminalError: string | null = null;

  async function worker() {
    while (cursor < groups.length) {
      const g = groups[cursor++];
      if (terminalError) {
        failed++;
        done++;
        results.push({ id: g.id, ok: false, message: terminalError });
        opts.onProgress?.({ done, total, success, failed, last: { id: g.id, name: g.recipient_name, ok: false, message: terminalError } });
        continue;
      }
      try {
        const r = await issueGroupLabel(g.id, carrier);
        success++;
        results.push({ id: g.id, ok: true, tracking_number: r.tracking_number });
        done++;
        opts.onProgress?.({ done, total, success, failed, last: { id: g.id, name: g.recipient_name, ok: true } });
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : "unknown error";
        if (/0200401002|토큰이 유효하지|访问令牌无效|token.*(?:invalid|expired)/i.test(message)) {
          terminalError = message;
        }
        results.push({ id: g.id, ok: false, message });
        done++;
        opts.onProgress?.({ done, total, success, failed, last: { id: g.id, name: g.recipient_name, ok: false, message } });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));
  return { results, success, failed, total };
}

/** All shipping groups referenced by the scan items of one order. */
export function useShippingGroupsForOrder(orderId: string | undefined) {
  return useQuery({
    enabled: !!orderId,
    queryKey: ["shipping_groups", orderId],
    queryFn: async () => {
      const { data: links, error: e1 } = await supabase
        .from("shipment_scan_items")
        .select("shipping_group_id")
        .eq("order_id", orderId!);
      if (e1) throw e1;
      const ids = [...new Set((links ?? []).map((l: any) => l.shipping_group_id).filter(Boolean))] as string[];
      if (!ids.length) return { groups: [] as ShippingGroupRow[], members: [] as any[] };

      const [{ data: groups, error: e2 }, { data: members, error: e3 }] = await Promise.all([
        supabase.from("shipping_groups").select("*").in("id", ids),
        supabase
          .from("shipment_scan_items")
          .select("id, order_id, position, qr_value, is_scanned, scanned_at, shipping_group_id, product_code, color, size, orders(external_order_id, source_data)")
          .in("shipping_group_id", ids)
          .order("position", { ascending: true }),
      ]);
      if (e2) throw e2;
      if (e3) throw e3;
      return { groups: (groups ?? []) as unknown as ShippingGroupRow[], members: members ?? [] };
    },
    refetchOnWindowFocus: false,
  });
}
