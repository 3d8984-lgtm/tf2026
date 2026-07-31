import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// 스테이지 ↔ 설비 매핑
// 카드 포장 = 99 · 카드 포장기(plc1), 세트 포장 = 88 · 티셔츠 포장기(세트포장)(plc0)
export const STAGE_PLC: Record<string, { plcId: string; label: string; nameKo: string; nameZh: string }> = {
  card: { plcId: "plc1", label: "99", nameKo: "카드 포장기", nameZh: "卡片包装机" },
  set: { plcId: "plc0", label: "88", nameKo: "티셔츠 포장기 (세트포장)", nameZh: "T恤包装机（套装包装）" },
};

export type PlcLive = {
  plcId: string;
  online: boolean;
  state: "running" | "stopped" | "fault" | "e_stop" | "unknown";
  count: number;
  duration: string;
  orderId: string | null;
};

const WORD_SHIFT = 65536;
export function normalizePlcCount(raw?: number | null): number {
  const v = Number(raw ?? 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v >= WORD_SHIFT && v % WORD_SHIFT === 0 ? v / WORD_SHIFT : v;
}

function proxyFetch(path: string) {
  // getSession() 을 매 폴링마다 호출하면 auth lock 경합으로 요청이 멈추므로 apikey 만 사용한다.
  return fetch(`${PROXY_BASE}${path}`, { headers: { apikey: ANON_KEY } });
}

/** 카드/세트 포장 설비의 실시간 상태 + 지정된 주문을 폴링한다. */
export function usePlcLive(): Record<string, PlcLive> {
  const [live, setLive] = useState<Record<string, PlcLive>>({});
  const [assigns, setAssigns] = useState<Record<string, string | null>>({});

  // 설비별 지정 주문 (상태 폴링과 분리 — DB 호출이 지연돼도 상태 표시는 계속 갱신되도록)
  useEffect(() => {
    let alive = true;
    const load = () => {
      supabase
        .from("plc_active_orders")
        .select("plc_id, order_id")
        .then(({ data }) => {
          if (!alive || !data) return;
          setAssigns(Object.fromEntries(data.map((a: any) => [a.plc_id, a.order_id ?? null])));
        });
    };
    load();
    const iv = setInterval(load, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    let alive = true;
    const entries = Object.entries(STAGE_PLC);

    const tick = async () => {
      const results: [string, Omit<PlcLive, "orderId">][] = await Promise.all(
        entries.map(async ([stage, m]): Promise<[string, Omit<PlcLive, "orderId">]> => {
          let online = false;
          let state: PlcLive["state"] = "unknown";
          let count = 0;
          let duration = "";
          try {
            const res = await proxyFetch(`/api/v1/plc/${m.plcId}/status`);
            console.log("PLCFETCH", m.plcId, res.status);
            if (res.ok) {
              const j: any = await res.json();
              if (!("upstream_status" in j)) {
                online = true;
                state = j.state ?? "unknown";
                count = normalizePlcCount(j.total_count);
                duration = j.operating_duration ?? "";
              }
            }
          } catch {
            online = false;
          }
          return [stage, { plcId: m.plcId, online, state, count, duration }];
        })
      );

      if (!alive) return;
      setLive((prev) =>
        Object.fromEntries(
          results.map(([stage, v]) => [stage, { ...v, orderId: prev[stage]?.orderId ?? null }])
        )
      );
    };

    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 지정 주문 정보를 상태에 병합
  const merged: Record<string, PlcLive> = Object.fromEntries(
    Object.entries(STAGE_PLC).map(([stage, m]) => [
      stage,
      {
        plcId: m.plcId,
        online: live[stage]?.online ?? false,
        state: live[stage]?.state ?? "unknown",
        count: live[stage]?.count ?? 0,
        duration: live[stage]?.duration ?? "",
        orderId: assigns[m.plcId] ?? null,
      },
    ])
  );

  return merged;
}
