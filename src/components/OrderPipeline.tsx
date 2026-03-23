import { Shirt, CreditCard, Package, Mail, Truck, CheckCircle2 } from "lucide-react";

const stages = [
  { key: "tshirt", label: "티셔츠 제작", icon: Shirt },
  { key: "card", label: "카드 포장", icon: CreditCard },
  { key: "set", label: "세트 포장", icon: Package },
  { key: "courier", label: "택배 포장", icon: Mail },
  { key: "invoice", label: "송장 부착", icon: Truck },
  { key: "done", label: "완료", icon: CheckCircle2 },
] as const;

type StageKey = (typeof stages)[number]["key"];

interface Order {
  id: string;
  product: string;
  design: string;
  qty: number;
  currentStage: StageKey;
  stageCounts: Record<StageKey, number>;
}

const orders: Order[] = [
  {
    id: "ORD-24831",
    product: "BT-2024-A",
    design: "DSN-047",
    qty: 200,
    currentStage: "set",
    stageCounts: { tshirt: 200, card: 185, set: 142, courier: 0, invoice: 0, done: 0 },
  },
  {
    id: "ORD-24832",
    product: "BT-2024-B",
    design: "DSN-012",
    qty: 150,
    currentStage: "courier",
    stageCounts: { tshirt: 150, card: 150, set: 150, courier: 98, invoice: 72, done: 72 },
  },
  {
    id: "ORD-24833",
    product: "BT-2024-C",
    design: "DSN-089",
    qty: 300,
    currentStage: "tshirt",
    stageCounts: { tshirt: 87, card: 0, set: 0, courier: 0, invoice: 0, done: 0 },
  },
  {
    id: "ORD-24834",
    product: "BT-2024-A",
    design: "DSN-047",
    qty: 120,
    currentStage: "invoice",
    stageCounts: { tshirt: 120, card: 120, set: 120, courier: 120, invoice: 108, done: 95 },
  },
  {
    id: "ORD-24835",
    product: "BT-2024-D",
    design: "DSN-103",
    qty: 80,
    currentStage: "done",
    stageCounts: { tshirt: 80, card: 80, set: 80, courier: 80, invoice: 80, done: 80 },
  },
];

const stageIndex = (key: StageKey) => stages.findIndex((s) => s.key === key);

function pct(count: number, total: number) {
  if (total === 0) return 0;
  return Math.round((count / total) * 100);
}

const stageColors: Record<StageKey, string> = {
  tshirt: "hsl(205 75% 42%)",
  card: "hsl(152 60% 42%)",
  set: "hsl(38 92% 50%)",
  courier: "hsl(280 55% 52%)",
  invoice: "hsl(205 75% 55%)",
  done: "hsl(152 60% 36%)",
};

const stageBgColors: Record<StageKey, string> = {
  tshirt: "hsl(205 75% 42% / 0.1)",
  card: "hsl(152 60% 42% / 0.1)",
  set: "hsl(38 92% 50% / 0.1)",
  courier: "hsl(280 55% 52% / 0.1)",
  invoice: "hsl(205 75% 55% / 0.1)",
  done: "hsl(152 60% 36% / 0.1)",
};

export default function OrderPipeline() {
  return (
    <div className="space-y-5">
      {/* Stage header – horizontal legend */}
      <div className="kpi-card section-enter">
        <div className="flex items-center gap-0 overflow-x-auto">
          {stages.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={s.key} className="flex items-center min-w-0">
                <div className="flex flex-col items-center gap-1 px-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: stageBgColors[s.key] }}
                  >
                    <Icon className="w-4 h-4" style={{ color: stageColors[s.key] }} />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                    {s.label}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <div className="w-8 h-px shrink-0" style={{ background: "hsl(var(--border))" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Order rows */}
      {orders.map((order, oi) => {
        const currentIdx = stageIndex(order.currentStage);
        const overallDone = order.stageCounts.done;
        const overallPct = pct(overallDone, order.qty);
        const isDone = order.currentStage === "done" && overallDone === order.qty;

        return (
          <div
            key={order.id}
            className="kpi-card section-enter"
            style={{ animationDelay: `${(oi + 1) * 80}ms` }}
          >
            {/* Order header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{order.id}</span>
                <span className="text-xs text-muted-foreground">
                  {order.product} · {order.design}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {overallDone} / {order.qty}
                </span>
                <span
                  className={`status-badge ${
                    isDone
                      ? "status-running"
                      : overallPct > 60
                      ? "status-warning"
                      : "status-idle"
                  }`}
                >
                  {isDone ? "완료" : `${overallPct}%`}
                </span>
              </div>
            </div>

            {/* Overall progress bar */}
            <div className="h-1.5 rounded-full mb-4" style={{ background: "hsl(var(--muted))" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${overallPct}%`,
                  background: isDone ? "hsl(var(--success))" : "hsl(var(--primary))",
                }}
              />
            </div>

            {/* Pipeline stages */}
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
                    <div
                      className={`flex-1 rounded-lg p-2.5 transition-all duration-200 ${
                        isActive ? "ring-1" : ""
                      }`}
                      style={{
                        background: isFuture
                          ? "hsl(var(--surface-sunken))"
                          : stageBgColors[s.key],
                        ringColor: isActive ? stageColors[s.key] : "transparent",
                        opacity: isFuture ? 0.5 : 1,
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Icon
                          className="w-3.5 h-3.5 shrink-0"
                          style={{
                            color: isFuture
                              ? "hsl(var(--muted-foreground))"
                              : stageColors[s.key],
                          }}
                        />
                        <span className="text-[10px] font-medium truncate text-muted-foreground">
                          {s.label}
                        </span>
                      </div>

                      {/* Mini progress */}
                      <div
                        className="h-1 rounded-full mb-1"
                        style={{ background: isFuture ? "hsl(var(--border))" : `${stageColors[s.key]}30` }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${stagePct}%`,
                            background: isFuture ? "hsl(var(--border))" : stageColors[s.key],
                          }}
                        />
                      </div>

                      <div className="flex items-baseline justify-between">
                        <span
                          className="text-xs font-semibold tabular-nums"
                          style={{
                            color: isFuture
                              ? "hsl(var(--muted-foreground))"
                              : stageColors[s.key],
                          }}
                        >
                          {count > 0 ? count : "-"}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {stagePct > 0 ? `${stagePct}%` : ""}
                        </span>
                      </div>
                    </div>

                    {si < stages.length - 1 && (
                      <div className="flex flex-col items-center justify-center px-0.5 shrink-0">
                        <div
                          className="w-3 h-px"
                          style={{
                            background:
                              isPast || isActive
                                ? stageColors[s.key]
                                : "hsl(var(--border))",
                            opacity: isPast || isActive ? 0.5 : 0.3,
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
