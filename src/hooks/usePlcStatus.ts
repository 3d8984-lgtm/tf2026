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
  orderId: string | null;
};

const WORD_SHIFT = 65536;
export function normalizePlcCount(raw?: number | null): number {
  const v = Number(raw ?? 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v >= WORD_SHIFT && v % WORD_SHIFT === 0 ? v / WORD_SHIFT : v;
}

async function proxyFetch(path: string) {
  const headers = new Headers();
  headers.set("apikey", ANON_KEY);
  const s = await supabase.auth.getSession();
  const token = s.data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${PROXY_BASE}${path}`, { headers });
}

/** 카드/세트 포장 설비의 실시간 상태 + 지정된 주문을 폴링한다. */
export function usePlcLive(): Record<string, PlcLive> {
  const [live, setLive] = useState<Record<string, PlcLive>>({});

  useEffect(() => {
    let alive = true;
    const entries = Object.entries(STAGE_PLC);

    const tick = async () => {
      const { data: assigns } = await supabase
        .from("plc_active_orders")
        .select("plc_id, order_id");
      const assignMap = new Map((assigns ?? []).map((a: any) => [a.plc_id, a.order_id as string | null]));

      const results = await Promise.all(
        entries.map(async ([stage, m]) => {
          let online = false;
          let state: PlcLive["state"] = "unknown";
          let count = 0;
          try {
            const res = await proxyFetch(`/api/v1/plc/${m.plcId}/status`);
            if (res.ok) {
              const j: any = await res.json();
              if (!("upstream_status" in j)) {
                online = true;
                state = j.state ?? "unknown";
                count = normalizePlcCount(j.total_count);
              }
            }
          } catch {
            online = false;
          }
          return [stage, { plcId: m.plcId, online, state, count, orderId: assignMap.get(m.plcId) ?? null }] as const;
        })
      );

      if (!alive) return;
      console.log("PLCLIVE", JSON.stringify(results));
      setLive(Object.fromEntries(results));
    };

    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return live;
}
