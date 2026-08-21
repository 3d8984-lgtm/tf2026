import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useLang } from "@/contexts/LangContext";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronRight } from "lucide-react";
import { useOrderNoMap } from "@/hooks/useOrderNoMap";
import { qcIsComplete } from "@/lib/tshirt-quality";

export default function TshirtQualityInspection() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);
  const navigate = useNavigate();
  const { data: orderNoMap } = useOrderNoMap();

  const { data: orders, isLoading } = useQuery({
    queryKey: ["tshirt_quality_orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, external_order_id, product_code, design_code, quantity, recipient_name, project_completed_at, created_at, source_data")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: inspections } = useQuery({
    queryKey: ["tshirt_quality_inspections_summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tshirt_quality_inspections")
        .select("order_id, seq, checks, result");
      if (error) throw error;
      return data ?? [];
    },
  });

  const summary = useMemo(() => {
    const map: Record<string, { done: number; fail: number; resolved: number }> = {};
    for (const row of inspections ?? []) {
      const cur = (map[row.order_id as string] ??= { done: 0, fail: 0, resolved: 0 });
      if (row.result === "fail") cur.fail += 1;
      else if (row.result === "resolved") { cur.resolved += 1; cur.done += 1; }
      else if (qcIsComplete(row.checks as any)) cur.done += 1;
    }
    return map;
  }, [inspections]);


  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={tr("티셔츠 품질 검사", "T恤品质检验")}
        description={tr(
          "주문을 선택하면 스티커 고유번호 스캔 녹화와 항목별 품질 검사 화면으로 이동합니다",
          "选择订单后进入贴纸唯一编号扫描录像与逐项品质检验界面",
        )}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (orders ?? []).length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-16">{tr("주문 데이터가 없습니다", "暂无订单数据")}</p>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">{tr("작업지시번호", "工单号")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("주문번호", "订单编号")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("트윈커", "Twinker")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("상품", "商品")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("수량", "数量")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("검사 진행", "检验进度")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("납기일", "交期")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {(orders ?? []).map((o: any) => {
                  const total = Math.max(Array.isArray(o.source_data?.items) ? o.source_data.items.length : 0, o.quantity ?? 0);
                  const s = summary[o.id] ?? { done: 0, fail: 0 };
                  const pct = total > 0 ? Math.round(((s.done + s.fail) / total) * 100) : 0;
                  return (
                    <tr
                      key={o.id}
                      className="border-t hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate(`/tshirt-quality/${o.id}`)}
                    >
                      <td className="px-4 py-3 font-mono font-medium text-primary hover:underline">{o.external_order_id}</td>
                      <td className="px-4 py-3 font-mono text-xs">{orderNoMap?.[o.id] ?? "-"}</td>
                      <td className="px-4 py-3">{o.recipient_name}</td>
                      <td className="px-4 py-3">{o.product_code}</td>
                      <td className="px-4 py-3">{total}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{s.done + s.fail}/{total}</span>
                          {s.fail > 0 && <Badge variant="destructive" className="text-[10px]">{tr("불량", "不良")} {s.fail}</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {o.project_completed_at ? new Date(o.project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN") : "-"}
                      </td>
                      <td className="px-4 py-3 text-right"><ChevronRight className="w-4 h-4 text-muted-foreground inline" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
