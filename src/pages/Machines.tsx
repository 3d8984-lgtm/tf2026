import PageHeader from "@/components/PageHeader";
import { Wifi, WifiOff, Gauge, AlertTriangle } from "lucide-react";
import OrderPipeline from "@/components/OrderPipeline";
import { useLang } from "@/contexts/LangContext";

export default function Machines() {
  const { t, lang } = useLang();

  const machines = [
    { id: "A-1", name: lang === "ko" ? "티셔츠 제작기 A-1" : "T恤制作机 A-1", status: "running", speed: "95", uptime: "97.2%", total: 38420, error: "-", lastComm: "14:37:05" },
    { id: "A-2", name: lang === "ko" ? "티셔츠 제작기 A-2" : "T恤制作机 A-2", status: "paused", speed: "-", uptime: "91.5%", total: 28150, error: "-", lastComm: "14:35:22" },
    { id: "A-3", name: lang === "ko" ? "티셔츠 제작기 A-3" : "T恤制作机 A-3", status: "running", speed: "92", uptime: "94.8%", total: 21560, error: "-", lastComm: "14:37:03" },
    { id: "B-1", name: lang === "ko" ? "카드 포장기 B-1" : "卡片包装机 B-1", status: "running", speed: "120", uptime: "96.1%", total: 42150, error: "-", lastComm: "14:37:01" },
    { id: "B-2", name: lang === "ko" ? "세트 포장기 B-2" : "套装包装机 B-2", status: "running", speed: "85", uptime: "93.4%", total: 31200, error: "-", lastComm: "14:36:58" },
    { id: "B-3", name: lang === "ko" ? "택배 포장기 B-3" : "快递包装机 B-3", status: "running", speed: "78", uptime: "88.5%", total: 18300, error: "-", lastComm: "14:36:55" },
    { id: "B-4", name: lang === "ko" ? "송장 부착기 B-4" : "运单贴附机 B-4", status: "running", speed: "110", uptime: "95.7%", total: 35680, error: "-", lastComm: "14:37:04" },
  ];

  const statusMap: Record<string, { badge: string; icon: typeof Wifi; label: string }> = {
    running: { badge: "status-running", icon: Wifi, label: t("status.running") },
    stopped: { badge: "status-stopped", icon: WifiOff, label: t("status.stopped") },
    paused: { badge: "status-warning", icon: Gauge, label: t("status.paused") },
    error: { badge: "status-stopped", icon: AlertTriangle, label: t("status.error") },
    disconnected: { badge: "status-stopped", icon: WifiOff, label: t("status.disconnected") },
  };

  return (
    <div>
      <PageHeader title={t("machines.title")} description={t("machines.desc")} />
      <div className="p-6 space-y-8">
        <div>
          <h2 className="text-sm font-semibold mb-4 text-foreground">{t("machines.orderPipeline")}</h2>
          <OrderPipeline />
        </div>
        <div>
          <h2 className="text-sm font-semibold mb-4 text-foreground">{t("machines.machineStatus")}</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {machines.map((m, i) => {
              const st = statusMap[m.status] || statusMap.stopped;
              const StIcon = st.icon;
              return (
                <div key={m.id} className="kpi-card section-enter" style={{ animationDelay: `${(i + 6) * 80}ms` }}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.id}</p>
                    </div>
                    <span className={`status-badge ${st.badge}`}><StIcon className="w-3 h-3" /> {st.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">{t("machines.speed")}</p><p className="font-medium tabular-nums">{m.speed !== "-" ? m.speed + t("common.perMin") : "-"}</p></div>
                    <div><p className="text-xs text-muted-foreground">{t("machines.uptime")}</p><p className="font-medium tabular-nums">{m.uptime}</p></div>
                    <div><p className="text-xs text-muted-foreground">{t("machines.totalWork")}</p><p className="font-medium tabular-nums">{m.total.toLocaleString()}</p></div>
                    <div><p className="text-xs text-muted-foreground">{t("machines.errorCode")}</p><p className={`font-medium ${m.error !== "-" ? "text-destructive" : ""}`}>{m.error}</p></div>
                  </div>
                  <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">{t("machines.lastComm")}: {m.lastComm}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
