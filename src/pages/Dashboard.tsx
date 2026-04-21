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
          {/* Chart - shows empty when no data */}
          <div className="lg:col-span-2 kpi-card section-enter" style={{ animationDelay: "300ms" }}>
            <h3 className="text-sm font-medium mb-4">{isKo ? "시간대별 생산량" : "每小时产量"}</h3>
            <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">
              {isKo ? "생산 데이터가 쌓이면 차트가 표시됩니다" : "生产数据积累后将显示图表"}
            </div>
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
          {/* Machine status - needs PLC integration */}
          <div className="kpi-card section-enter" style={{ animationDelay: "420ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.machineStatus")}</h3>
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              {isKo ? "PLC 연동 후 기계 상태가 표시됩니다" : "PLC连接后将显示设备状态"}
            </div>
          </div>

          {/* Recent exceptions from DB */}
          <div className="kpi-card section-enter" style={{ animationDelay: "480ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.exceptions")}</h3>
            <div className="space-y-2">
              {(shipments?.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result)).slice(0, 4) ?? []).map((s) => (
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
