import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * 생산/포장 모니터링 단계별 실적 집계.
 * PLC 신호가 아닌 실제 작업 메뉴 데이터를 소스로 사용한다.
 *  - tshirt  : 티셔츠 부착 작업 (tshirt_work_items)
 *  - card    : 카드 바코드 인쇄 작업 (barcode_print_items kind=card)
 *  - set     : 티셔츠 바코드 인쇄 작업 (barcode_print_items kind=tshirt)
 *  - courier : 택배 포장 작업 (shipment_scan_items)
 *  - done    : 위 4단계가 모두 완료된 수량 (최솟값)
 */
export type StageProgressKey = "tshirt" | "card" | "set" | "courier";

export type StageStat = {
  total: number;
  done: number;
  failed: number;
  testMode: boolean;
  lastAt: string | null;
  active: boolean; // 최근 5분 내 작업 기록
};

export type OrderStageProgress = Record<StageProgressKey, StageStat> & { done: number };
export type StageProgressMap = Record<string, OrderStageProgress>;

const emptyStat = (): StageStat => ({
  total: 0,
  done: 0,
  failed: 0,
  testMode: false,
  lastAt: null,
  active: false,
});

const emptyOrder = (): OrderStageProgress => ({
  tshirt: emptyStat(),
  card: emptyStat(),
  set: emptyStat(),
  courier: emptyStat(),
  done: 0,
});

export const STAGE_SOURCE: Record<string, { nameKo: string; nameZh: string }> = {
  tshirt: { nameKo: "티셔츠 부착 작업", nameZh: "T恤贴附作业" },
  card: { nameKo: "카드 바코드 인쇄 작업", nameZh: "卡片条码打印作业" },
  set: { nameKo: "티셔츠 바코드 인쇄 작업", nameZh: "T恤条码打印作业" },
  courier: { nameKo: "택배 포장 작업", nameZh: "快递包装作业" },
};

const ACTIVE_MS = 5 * 60 * 1000;

export function useStageProgress() {
  return useQuery({
    queryKey: ["stage-progress"],
    refetchInterval: 10000,
    queryFn: async (): Promise<StageProgressMap> => {
      const [barcodeRes, tshirtRes, scanRes] = await Promise.all([
        supabase
          .from("barcode_print_items")
          .select("kind, order_id, status, verdict, test_mode, printed_at, scanned_at, updated_at"),
        supabase
          .from("tshirt_work_items")
          .select("order_id, status, completed_at, updated_at"),
        supabase
          .from("shipment_scan_items")
          .select("order_id, is_scanned, scanned_at, updated_at"),
      ]);
      if (barcodeRes.error) throw barcodeRes.error;
      if (tshirtRes.error) throw tshirtRes.error;
      if (scanRes.error) throw scanRes.error;

      const map: StageProgressMap = {};
      const get = (orderId: string) => (map[orderId] ??= emptyOrder());
      const touch = (s: StageStat, at: string | null) => {
        if (at && (!s.lastAt || at > s.lastAt)) s.lastAt = at;
      };

      for (const row of (barcodeRes.data ?? []) as any[]) {
        const key: StageProgressKey | null =
          row.kind === "card" ? "card" : row.kind === "tshirt" ? "set" : null;
        if (!key) continue;
        const s = get(row.order_id)[key];
        s.total += 1;
        if (row.status === "done") s.done += 1;
        if (row.verdict && row.verdict !== "ok") s.failed += 1;
        if (row.test_mode) s.testMode = true;
        touch(s, row.printed_at ?? row.scanned_at ?? row.updated_at ?? null);
      }

      for (const row of (tshirtRes.data ?? []) as any[]) {
        const s = get(row.order_id).tshirt;
        s.total += 1;
        if (row.status === "done") s.done += 1;
        if (row.status === "fail") s.failed += 1;
        touch(s, row.completed_at ?? row.updated_at ?? null);
      }

      for (const row of (scanRes.data ?? []) as any[]) {
        const s = get(row.order_id).courier;
        s.total += 1;
        if (row.is_scanned) s.done += 1;
        touch(s, row.scanned_at ?? row.updated_at ?? null);
      }

      const now = Date.now();
      for (const orderId of Object.keys(map)) {
        const o = map[orderId];
        for (const key of ["tshirt", "card", "set", "courier"] as StageProgressKey[]) {
          const s = o[key];
          s.active = !!s.lastAt && now - new Date(s.lastAt).getTime() < ACTIVE_MS;
        }
        // 모든 단계가 완료된 수량 = 각 단계 완료 수량의 최솟값
        o.done = Math.min(o.tshirt.done, o.card.done, o.set.done, o.courier.done);
      }
      return map;
    },
  });
}
