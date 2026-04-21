import {
  Shirt, Package, Truck, AlertTriangle,
  ClipboardList, XCircle, Clock, CalendarIcon
} from "lucide-react";
import KpiCard from "@/components/KpiCard";
import PageHeader from "@/components/PageHeader";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useLang } from "@/contexts/LangContext";
import { useState, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay, addDays } from "date-fns";
import { ko, zhCN } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Period = "daily" | "weekly" | "monthly" | "custom";

function useDateRange(period: Period, selectedDate: Date, rangeFrom: Date, rangeTo: Date) {
  return useMemo(() => {
    switch (period) {
      case "daily":
        return { from: startOfDay(selectedDate), to: endOfDay(selectedDate) };
      case "weekly": {
        const ws = startOfWeek(selectedDate, { weekStartsOn: 1 });
        const we = endOfWeek(selectedDate, { weekStartsOn: 1 });
        return { from: ws, to: we };
      }
      case "monthly":
        return { from: startOfMonth(selectedDate), to: endOfMonth(selectedDate) };
      case "custom":
        return { from: startOfDay(rangeFrom), to: endOfDay(rangeTo) };
    }
  }, [period, selectedDate, rangeFrom, rangeTo]);
}

function useFilteredStats(from: Date, to: Date) {
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  return useQuery({
    queryKey: ["dashboard_stats", fromISO, toISO],
    queryFn: async () => {
      const [ordersRes, trackingRes, shipmentsRes] = await Promise.all([
        supabase.from("orders").select("status, quantity, created_at")
          .gte("created_at", fromISO).lte("created_at", toISO),
        supabase.from("production_tracking").select("stage, completed_count, created_at")
          .gte("created_at", fromISO).lte("created_at", toISO),
        supabase.from("shipments").select("status, inspect_result, set_id, order_id, created_at, orders(external_order_id)")
          .gte("created_at", fromISO).lte("created_at", toISO),
      ]);

      const orders = ordersRes.data ?? [];
      const tracking = trackingRes.data ?? [];
      const shipments = shipmentsRes.data ?? [];

      const totalOrders = orders.length;
      const totalQty = orders.reduce((s, o) => s + o.quantity, 0);

      const prodDone = tracking.filter(t => t.stage === "tshirt").reduce((s, t) => s + t.completed_count, 0);
      const cardDone = tracking.filter(t => t.stage === "card").reduce((s, t) => s + t.completed_count, 0);
      const setDone = tracking.filter(t => t.stage === "set").reduce((s, t) => s + t.completed_count, 0);
      const shipDone = shipments.filter(s => ["shipped", "in_transit", "delivered"].includes(s.status)).length;
      const errors = shipments.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result)).length;

      // Stage chart data
      const stageMap: Record<string, number> = {};
      for (const t of tracking) {
        stageMap[t.stage] = (stageMap[t.stage] || 0) + t.completed_count;
      }

      return { totalOrders, totalQty, prodDone, cardDone, setDone, shipDone, errors, stageMap, shipments };
    },
  });
}

// Also fetch all-time data for non-date-filtered sections
function useAllShipments() {
  return useQuery({
    queryKey: ["all_shipments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("*, orders(external_order_id, product_code, design_code)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export default function Dashboard() {
  const { t, lang } = useLang();
  const [period, setPeriod] = useState<Period>("monthly");
  const isKo = lang === "ko";
  const locale = isKo ? ko : zhCN;

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [rangeFrom, setRangeFrom] = useState<Date>(addDays(new Date(), -30));
  const [rangeTo, setRangeTo] = useState<Date>(new Date());

  const dateRange = useDateRange(period, selectedDate, rangeFrom, rangeTo);
  const { data: stats, isLoading: statsLoading } = useFilteredStats(dateRange.from, dateRange.to);
  const { data: allShipments } = useAllShipments();

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

  const stageLabels: Record<string, string> = {
    tshirt: t("process.tshirt"),
    card: t("process.card"),
    set: t("process.set"),
    weight: isKo ? "중량검사" : "重量检测",
    courier: isKo ? "택배포장" : "快递包装",
    invoice: isKo ? "송장부착" : "贴运单",
    done: isKo ? "완료" : "完成",
  };

  const stageColors: Record<string, string> = {
    tshirt: "hsl(205, 75%, 42%)",
    card: "hsl(152, 60%, 42%)",
    set: "hsl(38, 92%, 50%)",
    weight: "hsl(280, 55%, 52%)",
    courier: "hsl(340, 65%, 48%)",
    invoice: "hsl(190, 70%, 40%)",
    done: "hsl(120, 50%, 40%)",
  };

  // Chart data from stageMap
  const chartData = useMemo(() => {
    if (!stats?.stageMap) return [];
    const stages = ["tshirt", "card", "set", "weight", "courier", "invoice", "done"];
    return stages
      .filter(s => (stats.stageMap[s] || 0) > 0)
      .map(s => ({
        name: stageLabels[s] || s,
        value: stats.stageMap[s] || 0,
        color: stageColors[s],
      }));
  }, [stats?.stageMap, lang]);

  // Process progress
  const totalQty = Math.max(stats?.totalQty || 1, 1);
  const processProgress = [
    { name: t("process.tshirt"), value: Math.round(((stats?.prodDone ?? 0) / totalQty) * 100), color: stageColors.tshirt },
    { name: t("process.card"), value: Math.round(((stats?.cardDone ?? 0) / totalQty) * 100), color: stageColors.card },
    { name: t("process.set"), value: Math.round(((stats?.setDone ?? 0) / totalQty) * 100), color: stageColors.set },
    { name: t("process.shipping"), value: Math.round(((stats?.shipDone ?? 0) / Math.max(stats?.totalOrders ?? 1, 1)) * 100), color: stageColors.courier },
  ];

  // Pending shipments from all-time data
  const pendingShipmentsList = allShipments
    ?.filter(s => s.status === "pending")
    .slice(0, 5)
    .map(s => ({
      order: s.orders?.external_order_id ?? "-",
      product: s.orders?.product_code ?? "-",
      design: s.orders?.design_code ?? "-",
      status: t("status.invoiceWait"),
    })) ?? [];

  // Exceptions from filtered stats
  const exceptions = stats?.shipments
    ?.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result))
    .slice(0, 4) ?? [];

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
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard icon={ClipboardList} label={t("dashboard.todayOrders")} value={statsLoading ? "..." : String(stats?.totalOrders ?? 0)} change={`${isKo ? "총 수량" : "总数量"}: ${stats?.totalQty ?? 0}`} changeType="neutral" delay={0} />
          <KpiCard icon={Shirt} label={t("dashboard.prodDone")} value={statsLoading ? "..." : String(stats?.prodDone ?? 0)} change={`/ ${stats?.totalQty ?? 0}`} changeType="neutral" delay={60} />
          <KpiCard icon={Package} label={t("dashboard.setDone")} value={statsLoading ? "..." : String(stats?.setDone ?? 0)} change={`/ ${stats?.totalQty ?? 0}`} changeType="neutral" delay={120} />
          <KpiCard icon={Truck} label={t("dashboard.shipDone")} value={statsLoading ? "..." : String(stats?.shipDone ?? 0)} change={`/ ${stats?.totalOrders ?? 0}`} changeType="neutral" delay={180} />
          <KpiCard icon={AlertTriangle} label={t("dashboard.errors")} value={statsLoading ? "..." : String(stats?.errors ?? 0)} change={stats?.errors ? (isKo ? "확인 필요" : "需确认") : (isKo ? "이상 없음" : "无异常")} changeType={stats?.errors ? "negative" : "positive"} delay={240} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Real chart - production by stage */}
          <div className="lg:col-span-2 kpi-card section-enter" style={{ animationDelay: "300ms" }}>
            <h3 className="text-sm font-medium mb-4">{isKo ? "공정별 생산량" : "各工序产量"}</h3>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} name={isKo ? "완료 수량" : "完成数量"}>
                    {chartData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">
                {isKo ? "선택한 기간에 데이터가 없습니다" : "所选期间无数据"}
              </div>
            )}
          </div>

          <div className="kpi-card section-enter" style={{ animationDelay: "360ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.processProgress")}</h3>
            <div className="space-y-4">
              {processProgress.map((p) => (
                <div key={p.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{p.name}</span>
                    <span className="font-medium tabular-nums">{Math.min(p.value, 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: "hsl(var(--muted))" }}>
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(p.value, 100)}%`, background: p.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Machine status */}
          <div className="kpi-card section-enter" style={{ animationDelay: "420ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.machineStatus")}</h3>
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              {isKo ? "PLC 연동 후 기계 상태가 표시됩니다" : "PLC连接后将显示设备状态"}
            </div>
          </div>

          {/* Recent exceptions */}
          <div className="kpi-card section-enter" style={{ animationDelay: "480ms" }}>
            <h3 className="text-sm font-medium mb-4">{t("dashboard.exceptions")}</h3>
            <div className="space-y-2">
              {exceptions.map((s) => (
                <div key={s.set_id || s.order_id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                  <XCircle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {s.inspect_result === "mismatch" ? (isKo ? "QR 매칭 불일치" : "QR匹配不一致") : (isKo ? "중량 이상" : "重量异常")}
                    </p>
                    <p className="text-xs text-muted-foreground">{(s.orders as any)?.external_order_id ?? "-"} · {s.set_id}</p>
                  </div>
                </div>
              ))}
              {exceptions.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">{isKo ? "예외 없음" : "无异常"}</p>
              )}
            </div>
          </div>

          {/* Pending shipments */}
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
