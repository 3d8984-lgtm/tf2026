import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * 생산/포장 모니터링 연동용 훅.
 * 카드 포장 = 카드 바코드 인쇄 작업(kind: card)
 * 세트 포장 = 티셔츠 바코드 인쇄 작업(kind: tshirt)
 */
export type BarcodeKind = "card" | "tshirt";

export const STAGE_BARCODE: Record<string, { kind: BarcodeKind; nameKo: string; nameZh: string }> = {
  card: { kind: "card", nameKo: "카드 바코드 인쇄 작업", nameZh: "卡片条码打印作业" },
  set: { kind: "tshirt", nameKo: "티셔츠 바코드 인쇄 작업", nameZh: "T恤条码打印作业" },
};

export type BarcodeProgress = {
  total: number;
  done: number;
  failed: number;
  testMode: boolean;
  lastAt: string | null;
  active: boolean; // 최근 5분 내 작업 기록
};

export type BarcodeProgressMap = Record<string, Record<BarcodeKind, BarcodeProgress>>;

const empty = (): BarcodeProgress => ({ total: 0, done: 0, failed: 0, testMode: false, lastAt: null, active: false });

export function useBarcodePrintProgress() {
  return useQuery({
    queryKey: ["barcode-print-progress"],
    refetchInterval: 10000,
    queryFn: async (): Promise<BarcodeProgressMap> => {
      const { data, error } = await supabase
        .from("barcode_print_items")
        .select("kind, order_id, status, verdict, test_mode, printed_at, scanned_at, updated_at");
      if (error) throw error;

      const map: BarcodeProgressMap = {};
      const now = Date.now();
      for (const row of (data ?? []) as any[]) {
        const kind = row.kind as BarcodeKind;
        if (kind !== "card" && kind !== "tshirt") continue;
        if (!map[row.order_id]) map[row.order_id] = { card: empty(), tshirt: empty() };
        const p = map[row.order_id][kind];
        p.total += 1;
        if (row.status === "done") p.done += 1;
        if (row.verdict && row.verdict !== "ok") p.failed += 1;
        if (row.test_mode) p.testMode = true;
        const at = row.printed_at ?? row.scanned_at ?? row.updated_at ?? null;
        if (at && (!p.lastAt || at > p.lastAt)) p.lastAt = at;
      }
      for (const orderId of Object.keys(map)) {
        for (const kind of ["card", "tshirt"] as BarcodeKind[]) {
          const p = map[orderId][kind];
          p.active = !!p.lastAt && now - new Date(p.lastAt).getTime() < 5 * 60 * 1000;
        }
      }
      return map;
    },
  });
}
