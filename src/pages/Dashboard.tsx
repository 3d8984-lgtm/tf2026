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
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from "date-fns";
import { ko, zhCN } from "date-fns/locale";

type Period = "daily" | "weekly" | "monthly" | "custom";

export default function Dashboard() {
  const { t, lang } = useLang();
  const [period, setPeriod] = useState<Period>("daily");
  const isKo = lang === "ko";
  const locale = isKo ? ko : zhCN;

  // Date states
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [rangeFrom, setRangeFrom] = useState<Date>(addDays(new Date(), -7));
  const [rangeTo, setRangeTo] = useState<Date>(new Date());

  // Formatted display
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

  /* ── Period-dependent data ── */
  const kpiByPeriod: Record<Period, { orders: string; prod: string; set: string; ship: string; errors: string; orderChange: string; prodPct: string; setPct: string; shipPct: string; errChange: string }> = {
    daily: { orders: "1,240", prod: "876", set: "654", ship: "512", errors: "7", orderChange: "+8.3%", prodPct: "70.6%", setPct: "52.7%", shipPct: "41.3%", errChange: "-3" },
    weekly: { orders: "8,430", prod: "6,218", set: "4,892", ship: "3,740", errors: "42", orderChange: "+5.1%", prodPct: "73.8%", setPct: "58.1%", shipPct: "44.4%", errChange: "-12" },
    monthly: { orders: "34,620", prod: "26,480", set: "21,350", ship: "18,200", errors: "156", orderChange: "+12.7%", prodPct: "76.5%", setPct: "61.7%", shipPct: "52.6%", errChange: "-28" },
    custom: { orders: "5,820", prod: "4,130", set: "3,240", ship: "2,680", errors: "31", orderChange: "+6.4%", prodPct: "71.0%", setPct: "55.6%", shipPct: "46.1%", errChange: "-8" },
  };
  const kpi = kpiByPeriod[period];

  const chartDataByPeriod: Record<Period, { label: string; tshirt: number; card: number; set: number }[]> = {
    daily: [
      { label: "08", tshirt: 45, card: 62, set: 38 },
      { label: "09", tshirt: 78, card: 85, set: 65 },
      { label: "10", tshirt: 92, card: 98, set: 80 },
      { label: "11", tshirt: 85, card: 90, set: 72 },
      { label: "12", tshirt: 30, card: 35, set: 25 },
      { label: "13", tshirt: 88, card: 95, set: 78 },
      { label: "14", tshirt: 95, card: 102, set: 85 },
      { label: "15", tshirt: 72, card: 78, set: 60 },
    ],
    weekly: [
      { label: isKo ? "월" : "一", tshirt: 420, card: 480, set: 380 },
      { label: isKo ? "화" : "二", tshirt: 510, card: 560, set: 440 },
      { label: isKo ? "수" : "三", tshirt: 480, card: 530, set: 410 },
      { label: isKo ? "목" : "四", tshirt: 530, card: 590, set: 470 },
      { label: isKo ? "금" : "五", tshirt: 490, card: 540, set: 430 },
      { label: isKo ? "토" : "六", tshirt: 320, card: 360, set: 280 },
      { label: isKo ? "일" : "日", tshirt: 0, card: 0, set: 0 },
    ],
    monthly: [
      { label: "1W", tshirt: 2400, card: 2800, set: 2100 },
      { label: "2W", tshirt: 2650, card: 3000, set: 2350 },
      { label: "3W", tshirt: 2500, card: 2900, set: 2200 },
      { label: "4W", tshirt: 2700, card: 3100, set: 2500 },
    ],
    custom: [
      { label: format(rangeFrom, "M/d"), tshirt: 380, card: 420, set: 310 },
      { label: format(addDays(rangeFrom, 1), "M/d"), tshirt: 450, card: 490, set: 370 },
      { label: format(addDays(rangeFrom, 2), "M/d"), tshirt: 520, card: 560, set: 430 },
      { label: format(addDays(rangeFrom, 3), "M/d"), tshirt: 410, card: 470, set: 340 },
      { label: format(addDays(rangeFrom, 4), "M/d"), tshirt: 490, card: 530, set: 400 },
      { label: format(addDays(rangeFrom, 5), "M/d"), tshirt: 460, card: 510, set: 380 },
    ],
  };
  const chartData = chartDataByPeriod[period].map(d => ({
    label: d.label,
    [t("dashboard.tshirt")]: d.tshirt,
    [t("dashboard.card")]: d.card,
    [t("dashboard.set")]: d.set,
  }));

  const chartTitle: Record<Period, string> = {
    daily: isKo ? "시간대별 생산량" : "每小时产量",
    weekly: isKo ? "요일별 생산량" : "每日产量",
    monthly: isKo ? "주차별 생산량" : "每周产量",
    custom: isKo ? "일별 생산량" : "每日产量",
  };

  const changeLabel = period === "daily"
    ? t("dashboard.vsPrev")
    : period === "weekly"
      ? (isKo ? "전주 대비" : "与上周对比")
      : period === "monthly"
        ? (isKo ? "전월 대비" : "与上月对比")
        : (isKo ? "이전 기간 대비" : "与前期对比");

  const progressByPeriod: Record<Period, number[]> = {
    daily: [78, 85, 62, 45],
    weekly: [82, 88, 68, 52],
    monthly: [86, 91, 74, 60],
    custom: [80, 86, 65, 49],
  };
  const progressValues = progressByPeriod[period];

  const processProgress = [
    { name: t("process.tshirt"), value: progressValues[0], color: "hsl(205, 75%, 42%)" },
    { name: t("process.card"), value: progressValues[1], color: "hsl(152, 60%, 42%)" },
    { name: t("process.set"), value: progressValues[2], color: "hsl(38, 92%, 50%)" },
    { name: t("process.shipping"), value: progressValues[3], color: "hsl(280, 55%, 52%)" },
  ];

  const machineData = [
    { name: isKo ? "카드 포장기 A" : "卡片包装机 A", status: t("status.running"), uptime: "97.2%", count: 3842 },
    { name: isKo ? "세트 포장기 B" : "套装包装机 B", status: t("status.running"), uptime: "94.8%", count: 2156 },
    { name: isKo ? "택배봉투기 C" : "快递包装机 C", status: t("status.paused"), uptime: "88.5%", count: 1830 },
  ];

  const recentExceptions = [
    { id: "EX-0231", type: t("defects.qrMismatch"), process: t("process.tshirt"), time: "14:32", severity: "high" },
    { id: "EX-0230", type: t("defects.duplicateQR"), process: t("process.card"), time: "14:15", severity: "high" },
    { id: "EX-0229", type: t("defects.commError"), process: isKo ? "택배봉투기" : "快递包装机", time: "13:58", severity: "medium" },
    { id: "EX-0228", type: t("defects.printFail"), process: t("process.shipping"), time: "13:42", severity: "low" },
  ];

  const pendingShipments = [
    { order: "ORD-24831", product: "BT-2024-A", design: "DSN-047", status: t("status.invoiceWait") },
    { order: "ORD-24832", product: "BT-2024-B", design: "DSN-012", status: t("status.invoiceWait") },
    { order: "ORD-24833", product: "BT-2024-C", design: "DSN-089", status: t("status.shipHold") },
  ];

  return (
    <div>
      {/* Header row */}
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

        {/* Date selector row */}
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard icon={ClipboardList} label={period === "daily" ? t("dashboard.todayOrders") : t("dashboard.periodOrders")} value={kpi.orders} change={`${changeLabel} ${kpi.orderChange}`} changeType="positive" delay={0} />
          <KpiCard icon={Shirt} label={t("dashboard.prodDone")} value={kpi.prod} change={`${t("dashboard.vsTarget")} ${kpi.prodPct}`} changeType="neutral" delay={60} />
          <KpiCard icon={Package} label={t("dashboard.setDone")} value={kpi.set} change={`${t("dashboard.vsTarget")} ${kpi.setPct}`} changeType="neutral" delay={120} />
          <KpiCard icon={Truck} label={t("dashboard.shipDone")} value={kpi.ship} change={`${t("dashboard.vsTarget")} ${kpi.shipPct}`} changeType="neutral" delay={180} />
          <KpiCard icon={AlertTriangle} label={t("dashboard.errors")} value={kpi.errors} change={`${changeLabel} ${kpi.errChange}`} changeType="positive" delay={240} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 kpi-card section-enter" style={{ animationDelay: "300ms" }}>
            <h3 className="text-sm font-medium mb-4">{chartTitle[period]}</h3>
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
