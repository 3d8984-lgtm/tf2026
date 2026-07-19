import { Circle, PauseCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useOrderStatus,
  type FactoryKey,
  type OrderShippingStatus,
} from "@/hooks/useOrderStatus";

interface Props {
  factory: FactoryKey;
  orderNo: string;
}

const OPTIONS: { value: OrderShippingStatus; label: string; Icon: typeof Circle; color: string }[] = [
  { value: "pending",   label: "미발주",   Icon: Circle,         color: "text-muted-foreground" },
  { value: "hold",      label: "보류",     Icon: PauseCircle,    color: "text-amber-500" },
  { value: "completed", label: "발주완료", Icon: CheckCircle2,   color: "text-emerald-500" },
];

export function OrderStatusCell({ factory, orderNo }: Props) {
  const [status, setStatus] = useOrderStatus(factory, orderNo);

  return (
    <div
      className="inline-flex flex-col items-start gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {OPTIONS.map(({ value, label, Icon, color }) => {
        const active = status === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => setStatus(value)}
            className={cn(
              "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs transition-colors",
              active
                ? `${color} font-medium`
                : "text-muted-foreground/50 hover:text-foreground"
            )}
          >
            <Icon className={cn("w-3.5 h-3.5", active ? "" : "opacity-60")} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
