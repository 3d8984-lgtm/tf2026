import {
  Shirt, CreditCard, Package, Truck, AlertTriangle,
  ClipboardList, Monitor, CheckCircle2, XCircle, Clock
} from "lucide-react";
import KpiCard from "@/components/KpiCard";
import PageHeader from "@/components/PageHeader";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useLang } from "@/contexts/LangContext";

export default function Dashboard() {
  const { t, lang } = useLang();

  const hourlyData = [
    { hour: "08", [t("dashboard.tshirt")]: 45, [t("dashboard.card")]: 62, [t("dashboard.set")]: 38 },
    { hour: "09", [t("dashboard.tshirt")]: 78, [t("dashboard.card")]: 85, [t("dashboard.set")]: 65 },
    { hour: "10", [t("dashboard.tshirt")]: 92, [t("dashboard.card")]: 98, [t("dashboard.set")]: 80 },
    { hour: "11", [t("dashboard.tshirt")]: 85, [t("dashboard.card")]: 90, [t("dashboard.set")]: 72 },
    { hour: "12", [t("dashboard.tshirt")]: 30, [t("dashboard.card")]: 35, [t("dashboard.set")]: 25 },
    { hour: "13", [t("dashboard.tshirt")]: 88, [t("dashboard.card")]: 95, [t("dashboard.set")]: 78 },
    { hour: "14", [t("dashboard.tshirt")]: 95, [t("dashboard.card")]: 102, [t("dashboard.set")]: 85 },
    { hour: "15", [t("dashboard.tshirt")]: 72, [t("dashboard.card")]: 78, [t("dashboard.set")]: 60 },
  ];

  const machineData = [
    { name: lang === "ko" ? "카드 포장기 A" : "卡片包装机 A", status: t("status.running"), speed: "120" + t("common.perMin"), uptime: "97.2%", count: 3842 },
    { name: lang === "ko" ? "세트 포장기 B" : "套装包装机 B", status: t("status.running"), speed: "85" + t("common.perMin"), uptime: "94.8%", count: 2156 },
    { name: lang === "ko" ? "택배봉투기 C" : "快递包装机 C", status: t("status.paused"), speed: "-", uptime: "88.5%", count: 1830 },
  ];

  const recentExceptions = [
    { id: "EX-0231", type: t("defects.qrMismatch"), process: t("process.tshirt"), time: "14:32", severity: "high" },
    { id: "EX-0230", type: t("defects.duplicateQR"), process: t("process.card"), time: "14:15", severity: "high" },
    { id: "EX-0229", type: t("defects.commError"), process: lang === "ko" ? "택배봉투기" : "快递包装机", time: "13:58", severity: "medium" },
    { id: "EX-0228", type: t("defects.printFail"), process: t("process.shipping"), time: "13:42", severity: "low" },
  ];

  const processProgress = [
    { name: t("process.tshirt"), value: 78, color: "hsl(205, 75%, 42%)" },
    { name: t("process.card"), value: 85, color: "hsl(152, 60%, 42%)" },
    { name: t("process.set"), value: 62, color: "hsl(38, 92%, 50%)" },
    { name: t("process.shipping"), value: 45, color: "hsl(280, 55%, 52%)" },
  ];

  const pendingShipments = [
    { order: "ORD-24831", product: "BT-2024-A", design: "DSN-047", status: t("status.invoiceWait") },
    { order: "ORD-24832", product: "BT-2024-B", design: "DSN-012", status: t("status.invoiceWait") },
    { order: "ORD-24833", product: "BT-2024-C", design: "DSN-089", status: t("status.shipHold") },
  ];

  return (
    <div>
      <PageHeader title={t("dashboard.title")} description={t("dashboard.desc")} />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard icon={ClipboardList} label={t("dashboard.todayOrders")} value="1,240" change={`${t("dashboard.vsPrev")} +8.3%`} changeType="positive" delay={0} />
          <KpiCard icon={Shirt} label={t("dashboard.prodDone")} value="876" change={`${t("dashboard.vsTarget")} 70.6%`} changeType="neutral" delay={60} />
          <KpiCard icon={Package} label={t("dashboard.setDone")} value="654" change={`${t("dashboard.vsTarget")} 52.7%`} changeType="neutral" delay={120} />
          <KpiCard icon={Truck} label={t("dashboard.shipDone")} value="512" change={`${t("dashboard.vsTarget")} 41.3%`} changeType="neutral" delay={180} />
          <KpiCard icon={AlertTriangle} label={t("dashboard.errors")} value="7" change={`${t("dashboard.vsPrev")} -3`} changeType="positive" delay={240} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 kpi-card section-enter" style={{ animationDelay: "300ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.hourlyProd")}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hourlyData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 88%)" />
                <XAxis dataKey="hour" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(214, 20%, 88%)", fontSize: 12, boxShadow: "0 4px 12px hsl(215, 25%, 15%, 0.08)" }} />
                <Bar dataKey={t("dashboard.tshirt")} fill="hsl(205, 75%, 42%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey={t("dashboard.card")} fill="hsl(152, 60%, 42%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey={t("dashboard.set")} fill="hsl(38, 92%, 50%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="kpi-card section-enter" style={{ animationDelay: "360ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.processProgress")}</h3>
            <div className="space-y-4">
              {processProgress.map((p) => (
                <div key={p.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{p.name}</span>
                    <span className="font-medium tabular-nums">{p.value}%</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: "hsl(var(--muted))" }}>
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${p.value}%`, background: p.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="kpi-card section-enter" style={{ animationDelay: "420ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.machineStatus")}</h3>
            <div className="space-y-3">
              {machineData.map((m) => (
                <div key={m.name} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "hsl(var(--surface-sunken))" }}>
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("dashboard.uptime")} {m.uptime} · {m.count.toLocaleString()}{t("common.items")}</p>
                  </div>
                  <span className={`status-badge ${
                    m.status === t("status.running") ? "status-running" :
                    m.status === t("status.paused") ? "status-warning" : "status-stopped"
                  }`}>{m.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="kpi-card section-enter" style={{ animationDelay: "480ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.exceptions")}</h3>
            <div className="space-y-2">
              {recentExceptions.map((e) => (
                <div key={e.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                  {e.severity === "high" ? <XCircle className="w-4 h-4 mt-0.5 text-destructive shrink-0" /> :
                   e.severity === "medium" ? <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" /> :
                   <Clock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.type}</p>
                    <p className="text-xs text-muted-foreground">{e.process} · {e.time}</p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{e.id}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="kpi-card section-enter" style={{ animationDelay: "540ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.pendingInvoices")}</h3>
            <div className="space-y-2">
              {pendingShipments.map((s) => (
                <div key={s.order} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "hsl(var(--surface-sunken))" }}>
                  <div>
                    <p className="text-sm font-medium">{s.order}</p>
                    <p className="text-xs text-muted-foreground">{s.product} · {s.design}</p>
                  </div>
                  <span className={`status-badge ${s.status === t("status.shipHold") ? "status-warning" : "status-idle"}`}>{s.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
