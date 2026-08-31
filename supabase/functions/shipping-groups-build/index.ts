import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Grouping key = recipient name + phone + address + zip (light normalization only).
function norm(s: unknown) {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
function normPhone(s: unknown) {
  return String(s ?? "").replace(/[\s\-()]/g, "").trim();
}
function groupKey(r: { name: string; phone: string; address: string; zip: string }) {
  return [norm(r.name), normPhone(r.phone), norm(r.address), norm(r.zip)].join("|");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: approved } = await admin.rpc("is_approved", { _user_id: user.id });
    if (!approved) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const orderIds: string[] | null = Array.isArray(body?.order_ids) && body.order_ids.length ? body.order_ids : null;

    // Scope: the address-book scope (imported orders whose shipment is not reported yet).
    let oq = admin
      .from("orders")
      .select("id, quantity, source_data, recipient_phone, shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (orderIds) oq = oq.in("id", orderIds);
    else oq = oq.not("upload_history_id", "is", null);
    const { data: orders, error: oErr } = await oq;
    if (oErr) return json({ error: oErr.message }, 400);
    const ids = (orders ?? []).map((o: any) => o.id);
    if (!ids.length) return json({ ok: true, groups: 0, linked: 0 });

    const { data: itemRows, error: iErr } = await admin
      .from("shipment_scan_items")
      .select("id, order_id, position, shipping_group_id")
      .in("order_id", ids);
    if (iErr) return json({ error: iErr.message }, 400);

    const orderById = new Map<string, any>((orders ?? []).map((o: any) => [o.id, o]));

    // 한 택배(소포)당 담을 수 있는 최대 수량. 기본 2개.
    const MAX_PER_PARCEL = Math.max(1, Number(body?.max_per_parcel ?? 2) || 2);

    type Bucket = {
      key: string;
      recipient_name: string; recipient_phone: string;
      shipping_address: string; shipping_city: string | null; shipping_state: string | null;
      shipping_zip: string; shipping_country: string;
      items: { id: string; order_id: string; position: number }[];
    };
    const buckets = new Map<string, Bucket>();

    for (const it of itemRows ?? []) {
      const o = orderById.get(it.order_id);
      if (!o) continue;
      const src: any[] = Array.isArray(o.source_data?.items) ? o.source_data.items : [];
      const si: any = src[(it.position ?? 1) - 1] ?? {};
      const rec = {
        name: String(si.recipient_name ?? "").trim(),
        phone: String(si.recipient_phone ?? o.recipient_phone ?? "").trim(),
        address: String(si.shipping_address ?? o.shipping_address ?? "").trim(),
        zip: String(si.shipping_zip ?? o.shipping_zip ?? "").trim(),
      };
      if (!rec.name && !rec.address) continue; // no shipping recipient data yet
      const key = groupKey(rec);
      let b = buckets.get(key);
      if (!b) {
        b = {
          key,
          recipient_name: rec.name,
          recipient_phone: rec.phone,
          shipping_address: rec.address,
          shipping_city: si.shipping_city ?? o.shipping_city ?? null,
          shipping_state: si.shipping_state ?? o.shipping_state ?? null,
          shipping_zip: rec.zip,
          shipping_country: String(si.country_code ?? o.shipping_country ?? "US").trim() || "US",
          items: [],
        };
        buckets.set(key, b);
      }
      b.items.push({ id: it.id, order_id: it.order_id, position: Number(it.position ?? 1) });
    }

    // 동일 수취인 묶음을 소포 단위(최대 MAX_PER_PARCEL개)로 분할한다.
    // 예) 5개 주문 → 2개 / 2개 / 1개 = 송장 3건
    type Parcel = Omit<Bucket, "items" | "key"> & { key: string; itemIds: string[] };
    const parcels: Parcel[] = [];
    for (const b of buckets.values()) {
      // 분할 결과가 매번 동일하도록 정렬 (주문 → 순번)
      const sorted = b.items.slice().sort((x, y) =>
        x.order_id === y.order_id ? x.position - y.position : x.order_id.localeCompare(y.order_id),
      );
      for (let i = 0; i < sorted.length; i += MAX_PER_PARCEL) {
        const chunk = sorted.slice(i, i + MAX_PER_PARCEL);
        parcels.push({
          key: `${b.key}|p${Math.floor(i / MAX_PER_PARCEL) + 1}`,
          recipient_name: b.recipient_name,
          recipient_phone: b.recipient_phone,
          shipping_address: b.shipping_address,
          shipping_city: b.shipping_city,
          shipping_state: b.shipping_state,
          shipping_zip: b.shipping_zip,
          shipping_country: b.shipping_country,
          itemIds: chunk.map((c) => c.id),
        });
      }
    }

    if (!parcels.length) return json({ ok: true, groups: 0, linked: 0 });
    const parcelByKey = new Map<string, Parcel>(parcels.map((p) => [p.key, p]));
    const keys = parcels.map((p) => p.key);

    // Upsert groups (idempotent on group_key) — never touch tracking/label fields.
    const payload = parcels.map((b) => ({
      group_key: b.key,
      recipient_name: b.recipient_name,
      recipient_phone: b.recipient_phone,
      shipping_address: b.shipping_address,
      shipping_city: b.shipping_city,
      shipping_state: b.shipping_state,
      shipping_zip: b.shipping_zip,
      shipping_country: b.shipping_country,
      item_count: b.itemIds.length,
      required_scan_count: b.itemIds.length,
    }));

    const { data: upserted, error: uErr } = await admin
      .from("shipping_groups")
      .upsert(payload, { onConflict: "group_key" })
      .select("id, group_key");
    if (uErr) return json({ error: uErr.message }, 400);

    const idByKey = new Map<string, string>((upserted ?? []).map((g: any) => [g.group_key, g.id]));

    // Link scan items to their group (only when it changed).
    let linked = 0;
    const currentGroup = new Map<string, string | null>((itemRows ?? []).map((r: any) => [r.id, r.shipping_group_id]));
    for (const k of keys) {
      const gid = idByKey.get(k);
      if (!gid) continue;
      const toLink = parcelByKey.get(k)!.itemIds.filter((id) => currentGroup.get(id) !== gid);
      for (let i = 0; i < toLink.length; i += 200) {
        const chunk = toLink.slice(i, i + 200);
        const { error } = await admin.from("shipment_scan_items").update({ shipping_group_id: gid }).in("id", chunk);
        if (!error) linked += chunk.length;
      }
    }

    // Refresh scanned counters for the touched groups.
    const groupIds = [...idByKey.values()];
    const { data: scanned } = await admin
      .from("shipment_scan_items")
      .select("shipping_group_id, is_scanned")
      .in("shipping_group_id", groupIds);
    const counts = new Map<string, number>();
    for (const r of scanned ?? []) {
      if (!r.shipping_group_id) continue;
      if (r.is_scanned) counts.set(r.shipping_group_id, (counts.get(r.shipping_group_id) ?? 0) + 1);
    }
    for (const gid of groupIds) {
      const c = counts.get(gid) ?? 0;
      await admin.from("shipping_groups").update({ scanned_count: c }).eq("id", gid);
    }

    // 분할 이전(수취인 전체를 1건으로 묶던) 구 그룹 정리:
    // 남은 항목이 없고 송장도 발행되지 않은 그룹만 삭제한다.
    let removed = 0;
    const { data: stale } = await admin
      .from("shipping_groups")
      .select("id, tracking_number, label_status")
      .is("tracking_number", null);
    const staleIds = (stale ?? [])
      .filter((g: any) => !groupIds.includes(g.id) && g.label_status !== "issued")
      .map((g: any) => g.id);
    if (staleIds.length) {
      const { data: used } = await admin
        .from("shipment_scan_items")
        .select("shipping_group_id")
        .in("shipping_group_id", staleIds);
      const usedSet = new Set((used ?? []).map((r: any) => r.shipping_group_id));
      const deletable = staleIds.filter((id: string) => !usedSet.has(id));
      if (deletable.length) {
        const { error } = await admin.from("shipping_groups").delete().in("id", deletable);
        if (!error) removed = deletable.length;
      }
    }

    return json({ ok: true, groups: groupIds.length, linked, removed, max_per_parcel: MAX_PER_PARCEL });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
