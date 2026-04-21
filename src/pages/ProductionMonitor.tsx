import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLang } from "@/contexts/LangContext";
import OrderPipeline from "@/components/OrderPipeline";
import {
  Wifi, WifiOff, Gauge, AlertTriangle, ScanLine, Package,
  CheckCircle2, XCircle, Printer, Search, Activity, ChevronDown, ChevronRight,
  PlayCircle, OctagonX, ClipboardList, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useOrders, useProductionTracking, useShipments } from "@/hooks/useDbData";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function pct(a: number, b: number) { return b === 0 ? 0 : Math.round((a / b) * 100); }

export default function ProductionMonitor() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "orders");
  useEffect(() => { const t = searchParams.get("tab"); if (t) setTab(t); }, [searchParams]);

  // ── DB data ──
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: tracking } = useProductionTracking();
  const { data: shipments } = useShipments();
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const statusLabel: Record<string, string> = {
    received: isKo ? "접수" : "已接单",
    in_production: isKo ? "생산중" : "生产中",
    completed: isKo ? "완료" : "已完成",
    shipped: isKo ? "출고" : "已出库",
    cancelled: isKo ? "취소" : "已取消",
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "received": return { label: t("status.waiting"), cls: "status-idle" };
      case "in_production": return { label: t("status.inProgress"), cls: "status-running" };
      case "completed": return { label: t("status.completed"), cls: "status-running" };
      case "shipped": return { label: t("status.shipDone"), cls: "status-running" };
      case "cancelled": return { label: isKo ? "취소" : "已取消", cls: "status-stopped" };
      default: return { label: status, cls: "status-idle" };
    }
  };

  // Generate date-based sequential work order numbers
  const workOrderNumbers = React.useMemo(() => {
    if (!orders) return new Map<string, string>();
    const sorted = [...orders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const dateCounters: Record<string, number> = {};
    const map = new Map<string, string>();
    for (const o of sorted) {
      const d = new Date(o.created_at);
      const dateKey = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      dateCounters[dateKey] = (dateCounters[dateKey] || 0) + 1;
      map.set(o.id, `${dateKey}-${dateCounters[dateKey]}`);
    }
    return map;
  }, [orders]);

  const filtered = orders?.filter(wo => {
    if (!search) return true;
    const s = search.toLowerCase();
    const woNum = workOrderNumbers.get(wo.id) ?? "";
    return wo.external_order_id.toLowerCase().includes(s) ||
      wo.recipient_name.toLowerCase().includes(s) ||
      woNum.toLowerCase().includes(s);
  }) ?? [];

  const detailOrder = detailId ? orders?.find(o => o.id === detailId) : null;

  // Card/Set stats from production_tracking
  const cardStats = React.useMemo(() => {
    const cardTracking = (tracking ?? []).filter(t => t.stage === "card");
    const done = cardTracking.reduce((s, t) => s + t.completed_count, 0);
    return { done, total: orders?.reduce((s, o) => s + o.quantity, 0) ?? 0 };
  }, [tracking, orders]);

  const setStats = React.useMemo(() => {
    const setTracking = (tracking ?? []).filter(t => t.stage === "set");
    const done = setTracking.reduce((s, t) => s + t.completed_count, 0);
    return { done, total: orders?.reduce((s, o) => s + o.quantity, 0) ?? 0 };
  }, [tracking, orders]);

  // Shipping stats from shipments
  const shipStats = React.useMemo(() => {
    const all = shipments ?? [];
    return {
      invoiceWait: all.filter(s => s.status === "pending").length,
      shipped: all.filter(s => ["shipped", "in_transit", "delivered"].includes(s.status)).length,
      hold: all.filter(s => s.status === "hold").length,
      total: all.length,
    };
  }, [shipments]);

  return (
    <div>
      <PageHeader title={t("monitor.title")} description={t("monitor.desc")} />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="orders" className="gap-1.5"><ClipboardList className="w-3.5 h-3.5" />{isKo ? "주문 관리" : "订单管理"}</TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-1.5"><Activity className="w-3.5 h-3.5" />{t("monitor.tab.pipeline")}</TabsTrigger>
            <TabsTrigger value="card" className="gap-1.5"><ScanLine className="w-3.5 h-3.5" />{t("monitor.tab.card")}</TabsTrigger>
            <TabsTrigger value="set" className="gap-1.5"><Package className="w-3.5 h-3.5" />{t("monitor.tab.set")}</TabsTrigger>
            <TabsTrigger value="shipping" className="gap-1.5"><Printer className="w-3.5 h-3.5" />{t("monitor.tab.shipping")}</TabsTrigger>
            <TabsTrigger value="machines" className="gap-1.5"><Gauge className="w-3.5 h-3.5" />{t("monitor.tab.machines")}</TabsTrigger>
          </TabsList>

          {/* ═══ Orders Management ═══ */}
          <TabsContent value="orders" className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: isKo ? "전체" : "全部", value: orders?.length ?? 0 },
                { label: t("status.waiting"), value: orders?.filter(o => o.status === "received").length ?? 0 },
                { label: t("status.inProgress"), value: orders?.filter(o => o.status === "in_production").length ?? 0 },
                { label: t("status.completed"), value: orders?.filter(o => o.status === "completed").length ?? 0 },
                { label: t("status.shipDone"), value: orders?.filter(o => o.status === "shipped").length ?? 0 },
              ].map((s, i) => (
                <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
                  <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="kpi-card section-enter" style={{ animationDelay: "80ms" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("workOrders.search")} value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">{isKo ? "※ 주문은 '주문 데이터 가져오기'에서 접수됩니다" : "※ 订单通过'订单数据导入'接收"}</p>
              </div>

              {ordersLoading ? (
                <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        {[isKo ? "작업지시번호" : "工单编号", isKo ? "접수 날짜" : "接单日期", t("workOrders.qty"), isKo ? "트윈커" : "Twinker", t("workOrders.status"), isKo ? "상세" : "详情"].map(h => (
                          <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((wo) => {
                        const sb = statusBadge(wo.status);
                        const createdDate = new Date(wo.created_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN");
                        const woNumber = workOrderNumbers.get(wo.id) ?? "-";
                        return (
                          <tr key={wo.id} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 pr-4 font-medium tabular-nums">{woNumber}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{createdDate}</td>
                            <td className="py-2.5 tabular-nums pr-4">{wo.quantity.toLocaleString()}</td>
                            <td className="py-2.5 pr-4">{wo.recipient_name}</td>
                            <td className="py-2.5 pr-4"><span className={`status-badge ${sb.cls}`}>{sb.label}</span></td>
                            <td className="py-2.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailId(wo.id)} title={isKo ? "상세" : "详情"}><Eye className="w-3.5 h-3.5" /></Button>
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">{isKo ? "주문이 없습니다" : "暂无订单"}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ═══ Pipeline ═══ */}
          <TabsContent value="pipeline" className="space-y-6"><OrderPipeline /></TabsContent>

          {/* ═══ Card packing ═══ */}
          <TabsContent value="card" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="kpi-card section-enter text-center">
                <p className="text-2xl font-semibold tabular-nums">{cardStats.done}</p>
                <p className="text-sm text-muted-foreground mt-1">{isKo ? "포장 완료" : "包装完成"}</p>
              </div>
              <div className="kpi-card section-enter text-center" style={{ animationDelay: "60ms" }}>
                <p className="text-2xl font-semibold tabular-nums">{Math.max(0, cardStats.total - cardStats.done)}</p>
                <p className="text-sm text-muted-foreground mt-1">{isKo ? "대기중" : "待处理"}</p>
              </div>
            </div>
            <div className="kpi-card py-12 text-center text-muted-foreground">
              <ScanLine className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{isKo ? "카드 스캔 작업이 진행되면 실시간 로그가 표시됩니다" : "卡片扫描作业进行后将显示实时日志"}</p>
            </div>
          </TabsContent>

          {/* ═══ Set packing ═══ */}
          <TabsContent value="set" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="kpi-card section-enter text-center">
                <p className="text-2xl font-semibold tabular-nums">{setStats.done}</p>
                <p className="text-sm text-muted-foreground mt-1">{isKo ? "세트 완료" : "套装完成"}</p>
              </div>
              <div className="kpi-card section-enter text-center" style={{ animationDelay: "60ms" }}>
                <p className="text-2xl font-semibold tabular-nums">{Math.max(0, setStats.total - setStats.done)}</p>
                <p className="text-sm text-muted-foreground mt-1">{isKo ? "매칭 대기" : "待匹配"}</p>
              </div>
            </div>
            <div className="kpi-card py-12 text-center text-muted-foreground">
              <Package className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{isKo ? "세트 포장 작업이 진행되면 매칭 로그가 표시됩니다" : "套装包装作业进行后将显示匹配日志"}</p>
            </div>
          </TabsContent>

          {/* ═══ Shipping ═══ */}
          <TabsContent value="shipping" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="kpi-card section-enter text-center">
                <p className="text-2xl font-semibold tabular-nums">{shipStats.invoiceWait}</p>
                <p className="text-sm text-muted-foreground mt-1">{isKo ? "송장 대기" : "待打印运单"}</p>
              </div>
              <div className="kpi-card section-enter text-center" style={{ animationDelay: "60ms" }}>
                <p className="text-2xl font-semibold tabular-nums">{shipStats.shipped}</p>
                <p className="text-sm text-muted-foreground mt-1">{isKo ? "출고 완료" : "已出库"}</p>
              </div>
              <div className="kpi-card section-enter text-center" style={{ animationDelay: "120ms" }}>
                <p className="text-2xl font-semibold tabular-nums">{shipStats.hold}</p>
                <p className="text-sm text-muted-foreground mt-1">{isKo ? "보류" : "暂停"}</p>
              </div>
            </div>
            {shipStats.total === 0 ? (
              <div className="kpi-card py-12 text-center text-muted-foreground">
                <Printer className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">{isKo ? "출고 데이터가 없습니다" : "暂无出库数据"}</p>
              </div>
            ) : (
              <div className="kpi-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left">
                      {[isKo ? "세트ID" : "套装ID", isKo ? "주문번호" : "订单号", isKo ? "트윈커" : "Twinker", isKo ? "운송장" : "运单号", isKo ? "상태" : "状态"].map(h => (
                        <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {(shipments ?? []).slice(0, 20).map(s => (
                        <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-2 font-mono text-xs pr-4">{s.set_id ?? "-"}</td>
                          <td className="py-2 pr-4 text-xs">{s.orders?.external_order_id ?? "-"}</td>
                          <td className="py-2 pr-4">{s.orders?.recipient_name ?? "-"}</td>
                          <td className="py-2 font-mono text-xs pr-4">{s.tracking_number ?? <span className="text-muted-foreground italic">{isKo ? "미입력" : "未输入"}</span>}</td>
                          <td className="py-2"><span className={`status-badge ${["shipped", "in_transit", "delivered"].includes(s.status) ? "status-running" : s.status === "hold" ? "status-stopped" : "status-idle"}`}>{s.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ═══ Machine status ═══ */}
          <TabsContent value="machines" className="space-y-6">
            <div className="kpi-card py-12 text-center text-muted-foreground">
              <Gauge className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{isKo ? "PLC/게이트웨이 연동 후 기계 상태가 실시간으로 표시됩니다" : "PLC/网关连接后将实时显示设备状态"}</p>
              <p className="text-xs mt-2 text-muted-foreground/60">{isKo ? "시스템 설정 → 장비 관리에서 장비를 등록해주세요" : "请在系统设置 → 设备管理中注册设备"}</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={(v) => { if (!v) setDetailId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{isKo ? "주문 상세" : "订单详情"}</DialogTitle></DialogHeader>
          {detailOrder && (
            <div className="space-y-3 text-sm">
              {[
                [isKo ? "작업지시번호" : "工单编号", workOrderNumbers.get(detailOrder.id) ?? "-"],
                [isKo ? "수량" : "数量", String(detailOrder.quantity)],
                [isKo ? "트윈커" : "Twinker", detailOrder.recipient_name],
                [isKo ? "국가" : "国家", detailOrder.shipping_country],
                [isKo ? "상태" : "状态", statusLabel[detailOrder.status] ?? detailOrder.status],
                [isKo ? "접수일" : "接单日期", new Date(detailOrder.created_at).toLocaleString()],
                [isKo ? "납기일" : "交期", (detailOrder as any).project_completed_at ? new Date((detailOrder as any).project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN") : "-"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
