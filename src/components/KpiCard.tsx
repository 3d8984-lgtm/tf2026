import { type LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  delay?: number;
}

export default function KpiCard({ label, value, icon: Icon, change, changeType = "neutral", delay = 0 }: KpiCardProps) {
  return (
    <div className="kpi-card section-enter" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
          {change && (
            <p className={`text-xs mt-1 ${
              changeType === "positive" ? "text-success" :
              changeType === "negative" ? "text-destructive" :
              "text-muted-foreground"
            }`}>
              {change}
            </p>
          )}
        </div>
        <div className="p-2 rounded-lg" style={{ background: "hsl(var(--primary) / 0.08)" }}>
          <Icon className="w-5 h-5 text-primary" />
        </div>
      </div>
    </div>
  );
}
