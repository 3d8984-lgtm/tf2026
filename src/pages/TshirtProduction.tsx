import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { CheckCircle2, XCircle, Clock, ScanLine, ChevronDown, ChevronRight } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useOrders, useProductionTracking } from "@/hooks/useDbData";
import React from "react";

function pct(a: number, b: number) { return b === 0 ? 0 : Math.round((a / b) * 100); }

function OrderRow({ order, woNumber, t, lang }: { order: { qty: number; twinker: string; dueDate: string; createdDate: string; summary: { waiting: number; done: number; fail: number } }; woNumber: string; t: (k: string) => string; lang: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const donePct = pct(order.summary.done, order.qty);
  const isDone = order.summary.waiting === 0 && order.summary.fail === 0 && order.summary.done > 0;

  return (
    <div className="kpi-card section-enter">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <span className="font-semibold text-sm">{woNumber}</span>
          <span className="text-xs text-muted-foreground">{lang === "ko" ? "트윈커" : "Twinker"}: <strong className="text-foreground">{order.twinker}</strong></span>
          <span className="text-xs text-muted-foreground">{lang === "ko" ? "주문일" : "下单日"}: {order.createdDate}</span>
          <span className="text-xs text-muted-foreground">{lang === "ko" ? "납기" : "交期"}: {order.dueDate}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{lang === "ko" ? "수량" : "数量"}: {order.qty}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs tabular-nums text-muted-foreground">{order.summary.done}/{order.qty}</span>
          <div className="w-20 h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full transition-all" style={{ width: `${donePct}%`, background: isDone ? "hsl(var(--success))" : "hsl(var(--primary))" }} />
          </div>
          <span className="text-xs font-medium tabular-nums">{donePct}%</span>
          {order.summary.fail > 0 && <span className="status-badge status-stopped">{t("status.verifyFail")} {order.summary.fail}</span>}
        </div>
      </button>
      {isOpen && (
        <div className="mt-4 pt-4 border-t">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{t("status.waiting")}</span>
              <span className="font-semibold tabular-nums">{order.summary.waiting}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className="text-muted-foreground">{t("status.attachDone")}</span>
              <span className="font-semibold tabular-nums">{order.summary.done}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <XCircle className="w-3.5 h-3.5 text-destructive" />
              <span className="text-muted-foreground">{t("status.verifyFail")}</span>
              <span className="font-semibold tabular-nums">{order.summary.fail}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                {[t("tshirtProd.time"), lang === "ko" ? "색상" : "颜色", lang === "ko" ? "사이즈" : "尺码", t("tshirtProd.siliconQR"), t("tshirtProd.designQR"), t("tshirtProd.hologramQR"), t("tshirtProd.logoCol"), t("tshirtProd.result")].map(h => (
                  <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground text-sm">
                  {lang === "ko" ? "스캔 작업이 진행되면 로그가 여기에 표시됩니다" : "扫描作业进行后日志将显示在此"}
                </td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TshirtProduction() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: tracking } = useProductionTracking();

  // Generate work order numbers
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

  // Build order list from DB
  const orderRows = React.useMemo(() => {
    if (!orders) return [];
    return orders.map(o => {
      const tshirtTracking = (tracking ?? []).filter(t => t.order_id === o.id && t.stage === "tshirt");
      const done = tshirtTracking.reduce((s, t) => s + t.completed_count, 0);
      const waiting = Math.max(0, o.quantity - done);
      return {
        id: o.id,
        qty: o.quantity,
        twinker: o.recipient_name,
        createdDate: new Date(o.created_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN"),
        dueDate: o.project_completed_at ? new Date(o.project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN") : "-",
        summary: { waiting, done, fail: 0 },
      };
    });
  }, [orders, tracking, isKo]);

  const totalStats = orderRows.reduce((acc, o) => ({
    waiting: acc.waiting + o.summary.waiting,
    done: acc.done + o.summary.done,
    fail: acc.fail + o.summary.fail,
  }), { waiting: 0, done: 0, fail: 0 });

  const stats = [
    { label: t("status.waiting"), count: totalStats.waiting, icon: Clock, cls: "status-idle" },
    { label: t("status.attachDone"), count: totalStats.done, icon: CheckCircle2, cls: "status-running" },
    { label: t("status.verifyFail"), count: totalStats.fail, icon: XCircle, cls: "status-stopped" },
  ];

  if (ordersLoading) {
    return (
      <div>
        <PageHeader title={t("tshirtProd.title")} description={t("tshirtProd.desc")} />
        <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("tshirtProd.title")} description={t("tshirtProd.desc")} />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <div key={s.label} className="kpi-card section-enter flex items-center gap-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className={`p-2.5 rounded-lg ${s.cls}`}><s.icon className="w-5 h-5" /></div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{s.count}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {orderRows.length === 0 ? (
          <div className="kpi-card py-12 text-center text-muted-foreground">
            {isKo ? "주문 데이터가 없습니다. '주문 데이터 가져오기'에서 주문을 접수해주세요." : "暂无订单数据。请通过'订单数据导入'接收订单。"}
          </div>
        ) : (
          orderRows.map((o) => (
            <OrderRow key={o.id} order={o} woNumber={workOrderNumbers.get(o.id) ?? "-"} t={t} lang={lang} />
          ))
        )}
      </div>
    </div>
  );
}
