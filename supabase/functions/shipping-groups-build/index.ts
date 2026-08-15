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

    type Bucket = {
      key: string;
      recipient_name: string; recipient_phone: string;
      shipping_address: string; shipping_city: string | null; shipping_state: string | null;
      shipping_zip: string; shipping_country: string;
      itemIds: string[];
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
          itemIds: [],
        };
        buckets.set(key, b);
      }
      b.itemIds.push(it.id);
    }

    const keys = [...buckets.keys()];
    if (!keys.length) return json({ ok: true, groups: 0, linked: 0 });

    // Upsert groups (idempotent on group_key) — never touch tracking/label fields.
    const payload = keys.map((k) => {
      const b = buckets.get(k)!;
      return {
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
      };
    });

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
      const toLink = buckets.get(k)!.itemIds.filter((id) => currentGroup.get(id) !== gid);
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

    return json({ ok: true, groups: groupIds.length, linked });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
