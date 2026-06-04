import { Shirt, CreditCard, Package, Mail, Truck, CheckCircle2 } from "lucide-react";
import { useOrders, useProductionTracking } from "@/hooks/useDbData";
import { useLang } from "@/contexts/LangContext";

const stages = [
  { key: "tshirt", label_ko: "티셔츠 제작", label_zh: "T恤制作", icon: Shirt },
  { key: "card", label_ko: "카드 포장", label_zh: "卡片包装", icon: CreditCard },
  { key: "set", label_ko: "세트 포장", label_zh: "套装包装", icon: Package },
  { key: "courier", label_ko: "택배 포장", label_zh: "快递包装", icon: Mail },
  { key: "invoice", label_ko: "송장 부착", label_zh: "运单贴附", icon: Truck },
  { key: "done", label_ko: "완료", label_zh: "完成", icon: CheckCircle2 },
] as const;

type StageKey = (typeof stages)[number]["key"];

const stageColors: Record<StageKey, string> = {
  tshirt: "hsl(205 75% 42%)", card: "hsl(152 60% 42%)", set: "hsl(38 92% 50%)",
  courier: "hsl(280 55% 52%)", invoice: "hsl(205 75% 55%)", done: "hsl(152 60% 36%)",
};
const stageBgColors: Record<StageKey, string> = {
  tshirt: "hsl(205 75% 42% / 0.1)", card: "hsl(152 60% 42% / 0.1)", set: "hsl(38 92% 50% / 0.1)",
  courier: "hsl(280 55% 52% / 0.1)", invoice: "hsl(205 75% 55% / 0.1)", done: "hsl(152 60% 36% / 0.1)",
};

function pct(count: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((count / total) * 100));
}

interface OrderPipelineProps {
  onStageClick?: (orderId: string, stage: StageKey) => void;
}

export default function OrderPipeline({ onStageClick }: OrderPipelineProps = {}) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: tracking, isLoading: trackingLoading } = useProductionTracking();

  if (ordersLoading || trackingLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Generate date-based sequential work order numbers
  const sortedOrders = [...(orders ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const workOrderNumbers = (() => {
    const dateCounters: Record<string, number> = {};
    const map = new Map<string, string>();
    for (const o of sortedOrders) {
      const d = new Date(o.created_at);
      const dateKey = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      dateCounters[dateKey] = (dateCounters[dateKey] || 0) + 1;
      map.set(o.id, `${dateKey}-${dateCounters[dateKey]}`);
    }
    return map;
  })();

  // Build pipeline data from DB
  const pipelineOrders = (orders ?? []).map(order => {
    const orderTracking = (tracking ?? []).filter(t => t.order_id === order.id);
    const stageCounts: Record<StageKey, number> = { tshirt: 0, card: 0, set: 0, courier: 0, invoice: 0, done: 0 };

    orderTracking.forEach(t => {
      if (t.stage in stageCounts) {
        stageCounts[t.stage as StageKey] = t.completed_count;
      }
    });

    const stageKeys: StageKey[] = ["tshirt", "card", "set", "courier", "invoice", "done"];
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
      woNumber: workOrderNumbers.get(order.id) ?? "-",
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
        const stageKeys: StageKey[] = ["tshirt", "card", "set", "courier", "invoice", "done"];
        const currentIdx = stageKeys.indexOf(order.currentStage);
        const overallDone = order.stageCounts.done;
        const overallPct = pct(overallDone, order.qty);
        const isDone = order.currentStage === "done" && overallDone === order.qty;

        return (
          <div key={order.id} className="kpi-card section-enter" style={{ animationDelay: `${(oi + 1) * 80}ms` }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{order.woNumber}</span>
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
                const isActive = si === currentIdx;
                const isPast = si < currentIdx;
                const isFuture = si > currentIdx;
                const Icon = s.icon;

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
