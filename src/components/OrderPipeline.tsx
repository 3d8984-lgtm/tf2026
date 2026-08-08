import { Shirt, CreditCard, Package, Mail, Truck, CheckCircle2 } from "lucide-react";
import { useOrders } from "@/hooks/useDbData";
import { useLang } from "@/contexts/LangContext";
import { useStageProgress, STAGE_SOURCE, type StageStat, type StageProgressKey } from "@/hooks/useStageProgress";


const stages = [
  { key: "tshirt", label_ko: "티셔츠 제작", label_zh: "T恤制作", icon: Shirt },
  { key: "card", label_ko: "카드 포장", label_zh: "卡片包装", icon: CreditCard },
  { key: "set", label_ko: "세트 포장", label_zh: "套装包装", icon: Package },
  { key: "courier", label_ko: "택배 포장 · 송장 부착", label_zh: "快递包装 · 运单贴附", icon: Truck },
  { key: "done", label_ko: "완료", label_zh: "完成", icon: CheckCircle2 },
] as const;

type StageKey = (typeof stages)[number]["key"];

const stageColors: Record<StageKey, string> = {
  tshirt: "hsl(205 75% 42%)", card: "hsl(152 60% 42%)", set: "hsl(38 92% 50%)",
  courier: "hsl(280 55% 52%)", done: "hsl(152 60% 36%)",
};
const stageBgColors: Record<StageKey, string> = {
  tshirt: "hsl(205 75% 42% / 0.1)", card: "hsl(152 60% 42% / 0.1)", set: "hsl(38 92% 50% / 0.1)",
  courier: "hsl(280 55% 52% / 0.1)", done: "hsl(152 60% 36% / 0.1)",
};

function pct(count: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((count / total) * 100));
}


interface OrderPipelineProps {
  onStageClick?: (orderId: string, stage: StageKey) => void;
  onOrderClick?: (orderId: string) => void;
}


export default function OrderPipeline({ onStageClick, onOrderClick }: OrderPipelineProps = {}) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: stageProgress, isLoading: progressLoading } = useStageProgress();

  if (ordersLoading || progressLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // 각 단계 실적은 실제 작업 메뉴 데이터에서 집계 (PLC 미사용)
  const pipelineOrders = (orders ?? []).map(order => {
    const sp = stageProgress?.[order.id];
    const stageCounts: Record<StageKey, number> = {
      tshirt: sp?.tshirt.done ?? 0,
      card: sp?.card.done ?? 0,
      set: sp?.set.done ?? 0,
      courier: sp?.courier.done ?? 0,
      done: sp?.done ?? 0,
    };


    const stageKeys: StageKey[] = ["tshirt", "card", "set", "courier", "done"];
    let currentStage: StageKey = "tshirt";
    for (let i = stageKeys.length - 1; i >= 0; i--) {
      if (stageCounts[stageKeys[i]] > 0) {
        currentStage = stageKeys[i];
        break;
      }
    }


    const createdDate = new Date(order.created_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN");
    const dueDate = order.project_completed_at
      ? new Date(order.project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN")
      : "-";

    return {
      id: order.id,
      woNumber: order.external_order_id ?? "-",
      qty: order.quantity,
      currentStage,
      stageCounts,
      createdDate,
      dueDate,
    };
  });

  return (
    <div className="space-y-5">
      {/* Stage header */}
      <div className="kpi-card section-enter">
        <div className="flex items-center gap-0 overflow-x-auto">
          {stages.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={s.key} className="flex items-center min-w-0">
                <div className="flex flex-col items-center gap-1 px-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: stageBgColors[s.key] }}>
                    <Icon className="w-4 h-4" style={{ color: stageColors[s.key] }} />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                    {isKo ? s.label_ko : s.label_zh}
                  </span>
                </div>
                {i < stages.length - 1 && <div className="w-8 h-px shrink-0" style={{ background: "hsl(var(--border))" }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Order rows */}
      {pipelineOrders.map((order, oi) => {
        const stageKeys: StageKey[] = ["tshirt", "card", "set", "courier", "done"];
        
        const overallDone = order.stageCounts.done;
        const overallPct = pct(overallDone, order.qty);
        const isDone = order.currentStage === "done" && overallDone === order.qty;

        return (
          <div key={order.id} className="kpi-card section-enter" style={{ animationDelay: `${(oi + 1) * 80}ms` }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onOrderClick?.(order.id)}
                  className="text-sm font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded px-1 -mx-1"
                  title={isKo ? "주문 상세 보기" : "查看订单详情"}
                >
                  {order.woNumber}
                </button>
                <span className="text-xs text-muted-foreground">{isKo ? "접수" : "接单"}: {order.createdDate}</span>
                <span className="text-xs text-muted-foreground">{isKo ? "납기" : "交期"}: {order.dueDate}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">{overallDone} / {order.qty}</span>
                <span className={`status-badge ${isDone ? "status-running" : overallPct > 60 ? "status-warning" : "status-idle"}`}>
                  {isDone ? (isKo ? "완료" : "完成") : `${overallPct}%`}
                </span>
              </div>
            </div>

            <div className="h-1.5 rounded-full mb-4" style={{ background: "hsl(var(--muted))" }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${overallPct}%`, background: isDone ? "hsl(var(--success))" : "hsl(var(--primary))" }} />
            </div>

            <div className="flex items-stretch gap-0">
              {stages.map((s, si) => {
                const count = order.stageCounts[s.key];
                const stagePct = pct(count, order.qty);
                const Icon = s.icon;
                const src = STAGE_SOURCE[s.key];
                const prog: StageStat | undefined = src ? stageProgress?.[order.id]?.[s.key as StageProgressKey] : undefined;

                const isRunning = !!prog?.active;
                const hasWork = count > 0;
                const isComplete = order.qty > 0 && count >= order.qty;
                const isActive = isRunning || (hasWork && !isComplete);
                const isPast = isComplete;
                const isFuture = !hasWork && !isRunning;


                return (
                  <div key={s.key} className="flex items-center flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => onStageClick?.(order.id, s.key)}
                      className="flex-1 rounded-lg p-2.5 transition-all duration-200 text-left hover:ring-1 hover:ring-primary/40 cursor-pointer"
                      style={{
                        background: isFuture ? "hsl(var(--surface-sunken))" : stageBgColors[s.key],
                        opacity: isFuture ? 0.5 : 1,
                        boxShadow: isActive ? `inset 0 0 0 1px ${stageColors[s.key]}` : "none",
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: isFuture ? "hsl(var(--muted-foreground))" : stageColors[s.key] }} />
                        <span className="text-[10px] font-medium truncate text-muted-foreground">
                          {isKo ? s.label_ko : s.label_zh}
                        </span>
                      </div>

                      <div className="h-1 rounded-full mb-1" style={{ background: isFuture ? "hsl(var(--border))" : `${stageColors[s.key]}30` }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${stagePct}%`, background: isFuture ? "hsl(var(--border))" : stageColors[s.key] }} />
                      </div>

                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold tabular-nums" style={{ color: isFuture ? "hsl(var(--muted-foreground))" : stageColors[s.key] }}>
                          {count > 0 ? count : "-"}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{stagePct > 0 ? `${stagePct}%` : ""}</span>
                      </div>

                      {src && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/60">
                          <div className="flex items-center gap-1">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{
                                background: prog?.active
                                  ? "hsl(var(--success))"
                                  : (prog?.failed ?? 0) > 0
                                  ? "hsl(var(--destructive))"
                                  : "hsl(var(--muted-foreground))",
                              }}
                            />
                            <span className="text-[10px] font-medium text-muted-foreground truncate">
                              {isKo ? src.nameKo : src.nameZh} · {!prog || prog.total === 0
                                ? (isKo ? "미시작" : "未开始")
                                : prog.active
                                ? (isKo ? "작업중" : "作业中")
                                : prog.done >= order.qty && order.qty > 0
                                ? (isKo ? "완료" : "完成")
                                : (isKo ? "대기" : "待处理")}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{isKo ? "작업 완료" : "作业完成"}</span>
                            <span
                              className="text-[11px] font-semibold tabular-nums"
                              style={{ color: (prog?.done ?? 0) > 0 ? stageColors[s.key] : "hsl(var(--muted-foreground))" }}
                            >
                              {(prog?.done ?? 0).toLocaleString()} / {order.qty.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{isKo ? "최근 작업" : "最近作业"}</span>
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {prog?.lastAt ? new Date(prog.lastAt).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN", { hour: "2-digit", minute: "2-digit" }) : "-"}
                            </span>
                          </div>
                          {(prog?.failed ?? 0) > 0 && (
                            <div className="flex items-baseline justify-between mt-0.5">
                              <span className="text-[10px] text-muted-foreground">{isKo ? "오류" : "错误"}</span>
                              <span className="text-[11px] tabular-nums text-destructive font-semibold">{prog?.failed}</span>
                            </div>
                          )}
                          {prog?.testMode && (
                            <div className="mt-0.5 text-[10px] text-warning">{isKo ? "테스트 모드" : "测试模式"}</div>
                          )}
                        </div>
                      )}
                    </button>


                    {si < stages.length - 1 && (
                      <div className="flex flex-col items-center justify-center px-0.5 shrink-0">
                        <div className="w-3 h-px" style={{ background: isPast || isActive ? stageColors[s.key] : "hsl(var(--border))", opacity: isPast || isActive ? 0.5 : 0.3 }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {pipelineOrders.length === 0 && (
        <div className="kpi-card text-center py-8 text-muted-foreground">
          {isKo ? "주문 데이터가 없습니다" : "暂无订单数据"}
        </div>
      )}
    </div>
  );
}
