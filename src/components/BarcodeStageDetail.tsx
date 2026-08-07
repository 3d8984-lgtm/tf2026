import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import { STAGE_BARCODE } from "@/hooks/useBarcodePrintProgress";
import { ScanLine } from "lucide-react";

interface Props {
  orderId: string;
  stage: "card" | "set";
}

/** 카드/세트 포장 단계 = 바코드 인쇄 작업 데이터 상세 */
export default function BarcodeStageDetail({ orderId, stage }: Props) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const src = STAGE_BARCODE[stage];

  const { data: items } = useQuery({
    queryKey: ["barcode-stage-detail", orderId, src.kind],
    refetchInterval: 10000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("barcode_print_items")
        .select("id, position, code, status, verdict, test_mode, printed_at, scanned_at")
        .eq("order_id", orderId)
        .eq("kind", src.kind)
        .order("position", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <p className="text-xs font-medium mb-2 text-muted-foreground">
        {isKo ? src.nameKo : src.nameZh} {isKo ? "연동 내역" : "联动记录"}
      </p>
      {!items || items.length === 0 ? (
        <div className="border rounded p-4 text-center text-xs text-muted-foreground">
          <ScanLine className="w-5 h-5 mx-auto mb-2 opacity-40" />
          {isKo ? "바코드 인쇄 작업 기록이 없습니다" : "暂无条码打印作业记录"}
        </div>
      ) : (
        <div className="border rounded overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-left">
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">{isKo ? "고유번호" : "唯一编号"}</th>
                <th className="px-2 py-1.5">{isKo ? "상태" : "状态"}</th>
                <th className="px-2 py-1.5">{isKo ? "시간" : "时间"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any) => (
                <tr key={it.id} className="border-t">
                  <td className="px-2 py-1.5 tabular-nums">{it.position}</td>
                  <td className="px-2 py-1.5 font-mono">{it.code}</td>
                  <td className="px-2 py-1.5">
                    {it.status === "done"
                      ? (isKo ? "완료" : "完成")
                      : it.verdict && it.verdict !== "ok"
                      ? (isKo ? "오류" : "错误")
                      : (isKo ? "대기" : "待处理")}
                    {it.test_mode && <span className="ml-1 text-[10px] text-muted-foreground">(TEST)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {it.printed_at || it.scanned_at
                      ? new Date(it.printed_at ?? it.scanned_at).toLocaleString(isKo ? "ko-KR" : "zh-CN")
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
