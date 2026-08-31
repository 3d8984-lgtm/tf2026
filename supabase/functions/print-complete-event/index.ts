// 프린터 인쇄 완료 이벤트 수신 API
// 게이트웨이/프린터 감시 프로그램이 실제 출력 완료(0x40) 신호를 받은 순간 호출한다.
//
//  POST /functions/v1/print-complete-event
//    headers: x-print-secret: <PRINT_EVENT_SECRET>   (설정된 경우 필수)
//    body:  { "code": "…-4", "job_id": "a1b2c3d4", "printed": true,
//             "printed_at": "2026-08-31T02:00:00Z", "device": "PF-A", "error": null }
//    또는   { "events": [ { …위와 동일… }, … ] }   (배치 전송)
//
//  GET  /functions/v1/print-complete-event?since=<ISO>&limit=100
//    최근 완료 이벤트 목록 조회 (앱 UI 용)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-print-secret, x-webhook-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Incoming = {
  code?: string;
  barcode?: string;
  text?: string;
  job_id?: string;
  id?: string;
  printed?: boolean;
  printed_at?: string;
  completed_at?: string;
  device?: string;
  printer?: string;
  error?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const since = url.searchParams.get("since");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
      let q = supabase
        .from("print_complete_events")
        .select("id, code, job_id, device, printed, error, event_at")
        .order("event_at", { ascending: false })
        .limit(limit);
      if (since) q = q.gt("event_at", since);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ events: data ?? [] });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // 공유 시크릿 검증 (설정돼 있을 때만)
    const secret = Deno.env.get("PRINT_EVENT_SECRET");
    if (secret) {
      const provided =
        req.headers.get("x-print-secret") ?? req.headers.get("x-webhook-secret");
      if (provided !== secret) return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const list: Incoming[] = Array.isArray(body?.events)
      ? body.events
      : Array.isArray(body)
        ? body
        : [body];

    const results: Array<{ code: string; matched: boolean }> = [];

    for (const ev of list) {
      const code = String(ev.code ?? ev.barcode ?? ev.text ?? "").trim();
      if (!code) continue;
      const printed = ev.printed !== false && !ev.error;
      const eventAt = ev.printed_at ?? ev.completed_at ?? new Date().toISOString();
      const jobId = ev.job_id ?? ev.id ?? null;
      const device = ev.device ?? ev.printer ?? null;

      // 같은 바코드의 최신 인쇄 항목을 찾아 확인 시각을 기록한다.
      const { data: item } = await supabase
        .from("barcode_print_items")
        .select("id")
        .eq("code", code)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (item?.id && printed) {
        await supabase
          .from("barcode_print_items")
          .update({
            print_confirmed_at: eventAt,
            printed_at: eventAt,
            printer_job_id: jobId,
            status: "done",
          })
          .eq("id", item.id);
      }

      await supabase.from("print_complete_events").insert({
        code,
        job_id: jobId,
        device,
        printed,
        error: ev.error ?? null,
        raw: ev as unknown as Record<string, unknown>,
        matched_item_id: item?.id ?? null,
        event_at: eventAt,
      });

      results.push({ code, matched: !!item?.id });
    }

    return json({ ok: true, received: results.length, results });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
