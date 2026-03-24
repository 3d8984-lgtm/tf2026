import {
  Shirt, Package, Truck, AlertTriangle,
  ClipboardList, XCircle, Clock, CalendarIcon
} from "lucide-react";
import KpiCard from "@/components/KpiCard";
import PageHeader from "@/components/PageHeader";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useLang } from "@/contexts/LangContext";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, startOfWeek, endOfWeek, addDays } from "date-fns";
import { ko, zhCN } from "date-fns/locale";
import { useOrderStats, useOrders, useShipments } from "@/hooks/useDbData";

type Period = "daily" | "weekly" | "monthly" | "custom";

export default function Dashboard() {
  const { t, lang } = useLang();
  const [period, setPeriod] = useState<Period>("daily");
  const isKo = lang === "ko";
  const locale = isKo ? ko : zhCN;

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [rangeFrom, setRangeFrom] = useState<Date>(addDays(new Date(), -7));
  const [rangeTo, setRangeTo] = useState<Date>(new Date());

  // DB data
  const { data: stats, isLoading: statsLoading } = useOrderStats();
  const { data: orders } = useOrders();
  const { data: shipments } = useShipments();

  const getDateDisplay = () => {
    switch (period) {
      case "daily":
        return format(selectedDate, isKo ? "yyyy년 M월 d일 (EEE)" : "yyyy年M月d日 (EEE)", { locale });
      case "weekly": {
        const ws = startOfWeek(selectedDate, { weekStartsOn: 1 });
        const we = endOfWeek(selectedDate, { weekStartsOn: 1 });
        return `${format(ws, "M/d", { locale })} ~ ${format(we, "M/d", { locale })}`;
      }
      case "monthly":
        return format(selectedDate, isKo ? "yyyy년 M월" : "yyyy年M月", { locale });
      case "custom":
        return `${format(rangeFrom, "M/d", { locale })} ~ ${format(rangeTo, "M/d", { locale })}`;
    }
  };

  const changeLabel = period === "daily"
    ? t("dashboard.vsPrev")
    : period === "weekly"
      ? (isKo ? "전주 대비" : "与上周对比")
      : period === "monthly"
        ? (isKo ? "전월 대비" : "与上月对比")
        : (isKo ? "이전 기간 대비" : "与前期对比");

  // Chart data (still mock for now as time-series aggregation needs more complex queries)
  const chartData = [
    { label: "08", [t("dashboard.tshirt")]: 45, [t("dashboard.card")]: 62, [t("dashboard.set")]: 38 },
    { label: "09", [t("dashboard.tshirt")]: 78, [t("dashboard.card")]: 85, [t("dashboard.set")]: 65 },
    { label: "10", [t("dashboard.tshirt")]: 92, [t("dashboard.card")]: 98, [t("dashboard.set")]: 80 },
    { label: "11", [t("dashboard.tshirt")]: 85, [t("dashboard.card")]: 90, [t("dashboard.set")]: 72 },
    { label: "12", [t("dashboard.tshirt")]: 30, [t("dashboard.card")]: 35, [t("dashboard.set")]: 25 },
    { label: "13", [t("dashboard.tshirt")]: 88, [t("dashboard.card")]: 95, [t("dashboard.set")]: 78 },
    { label: "14", [t("dashboard.tshirt")]: 95, [t("dashboard.card")]: 102, [t("dashboard.set")]: 85 },
    { label: "15", [t("dashboard.tshirt")]: 72, [t("dashboard.card")]: 78, [t("dashboard.set")]: 60 },
  ];

  // Process progress from DB stats
  const totalQty = stats?.totalQty || 1;
  const processProgress = [
    { name: t("process.tshirt"), value: Math.round(((stats?.prodDone ?? 0) / totalQty) * 100), color: "hsl(205, 75%, 42%)" },
    { name: t("process.card"), value: Math.round(((stats?.prodDone ?? 0) / totalQty) * 100), color: "hsl(152, 60%, 42%)" },
    { name: t("process.set"), value: Math.round(((stats?.setDone ?? 0) / totalQty) * 100), color: "hsl(38, 92%, 50%)" },
    { name: t("process.shipping"), value: Math.round(((stats?.shipDone ?? 0) / Math.max(stats?.totalOrders ?? 1, 1)) * 100), color: "hsl(280, 55%, 52%)" },
  ];

  // Pending shipments from DB
  const pendingShipmentsList = shipments
    ?.filter(s => s.status === "pending")
    .slice(0, 5)
    .map(s => ({
      order: s.orders?.external_order_id ?? "-",
      product: s.orders?.product_code ?? "-",
      design: s.orders?.design_code ?? "-",
      status: t("status.invoiceWait"),
    })) ?? [];

  return (
    <div>
      <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <PageHeader title={t("dashboard.title")} description={t("dashboard.desc")} />
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList className="h-9">
              <TabsTrigger value="daily" className="text-xs px-3">{t("dashboard.daily")}</TabsTrigger>
              <TabsTrigger value="weekly" className="text-xs px-3">{t("dashboard.weekly")}</TabsTrigger>
              <TabsTrigger value="monthly" className="text-xs px-3">{t("dashboard.monthly")}</TabsTrigger>
              <TabsTrigger value="custom" className="text-xs px-3">{t("dashboard.custom")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CalendarIcon className="w-4 h-4 text-muted-foreground" />
          {period === "custom" ? (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {format(rangeFrom, "yyyy-MM-dd")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={rangeFrom} onSelect={(d) => d && setRangeFrom(d)} locale={locale} className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
              <span className="text-sm text-muted-foreground">~</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {format(rangeTo, "yyyy-MM-dd")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={rangeTo} onSelect={(d) => d && setRangeTo(d)} locale={locale} className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  <CalendarIcon className="w-3.5 h-3.5" />
                  {getDateDisplay()}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} locale={locale} className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          )}
          <span className="text-xs text-muted-foreground ml-1">{getDateDisplay()}</span>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* KPI Cards - from DB */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard icon={ClipboardList} label={t("dashboard.todayOrders")} value={statsLoading ? "..." : String(stats?.totalOrders ?? 0)} change={`${changeLabel}`} changeType="neutral" delay={0} />
          <KpiCard icon={Shirt} label={t("dashboard.prodDone")} value={statsLoading ? "..." : String(stats?.prodDone ?? 0)} change={`${t("dashboard.vsTarget")}`} changeType="neutral" delay={60} />
          <KpiCard icon={Package} label={t("dashboard.setDone")} value={statsLoading ? "..." : String(stats?.setDone ?? 0)} change={`${t("dashboard.vsTarget")}`} changeType="neutral" delay={120} />
          <KpiCard icon={Truck} label={t("dashboard.shipDone")} value={statsLoading ? "..." : String(stats?.shipDone ?? 0)} change={`${t("dashboard.vsTarget")}`} changeType="neutral" delay={180} />
          <KpiCard icon={AlertTriangle} label={t("dashboard.errors")} value={statsLoading ? "..." : String(stats?.errors ?? 0)} change={changeLabel} changeType={stats?.errors ? "negative" : "positive"} delay={240} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 kpi-card section-enter" style={{ animationDelay: "300ms" }}>
            <h3 className="text-sm font-medium mb-4">{isKo ? "시간대별 생산량" : "每小时产量"}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 88%)" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
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
          {/* Machine status - still mock (needs separate machine table) */}
          <div className="kpi-card section-enter" style={{ animationDelay: "420ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.machineStatus")}</h3>
            <div className="space-y-3">
              {[
                { name: isKo ? "카드 포장기 A" : "卡片包装机 A", status: t("status.running"), uptime: "97.2%", count: 3842 },
                { name: isKo ? "세트 포장기 B" : "套装包装机 B", status: t("status.running"), uptime: "94.8%", count: 2156 },
                { name: isKo ? "택배봉투기 C" : "快递包装机 C", status: t("status.paused"), uptime: "88.5%", count: 1830 },
              ].map((m) => (
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

          {/* Recent exceptions - mock (needs defects table) */}
          <div className="kpi-card section-enter" style={{ animationDelay: "480ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.exceptions")}</h3>
            <div className="space-y-2">
              {(shipments?.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result)).slice(0, 4) ?? []).map((s, i) => (
                <div key={s.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                  <XCircle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {s.inspect_result === "mismatch" ? (isKo ? "QR 매칭 불일치" : "QR匹配不一致") : (isKo ? "중량 이상" : "重量异常")}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.orders?.external_order_id} · {s.set_id}</p>
                  </div>
                </div>
              ))}
              {(!shipments || shipments.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result)).length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">{isKo ? "예외 없음" : "无异常"}</p>
              )}
            </div>
          </div>

          {/* Pending shipments from DB */}
          <div className="kpi-card section-enter" style={{ animationDelay: "540ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.pendingInvoices")}</h3>
            <div className="space-y-2">
              {pendingShipmentsList.map((s, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "hsl(var(--surface-sunken))" }}>
                  <div>
                    <p className="text-sm font-medium">{s.order}</p>
                    <p className="text-xs text-muted-foreground">{s.product} · {s.design}</p>
                  </div>
                  <span className="status-badge status-idle">{s.status}</span>
                </div>
              ))}
              {pendingShipmentsList.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">{isKo ? "대기중인 송장 없음" : "无待处理运单"}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
