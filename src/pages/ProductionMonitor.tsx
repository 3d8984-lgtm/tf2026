import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLang } from "@/contexts/LangContext";
import OrderPipeline from "@/components/OrderPipeline";
import CctvMonitor from "@/components/CctvMonitor";
import { Gauge, ScanLine, Package, Printer, Activity, Shirt, CreditCard, Mail, Truck, CheckCircle2, Video } from "lucide-react";
import { useOrders, useProductionTracking, useShipments } from "@/hooks/useDbData";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type StageKey = "tshirt" | "card" | "set" | "courier" | "invoice" | "done";

const stageMeta: Record<StageKey, { ko: string; zh: string; Icon: typeof Shirt }> = {
  tshirt: { ko: "티셔츠 제작", zh: "T恤制作", Icon: Shirt },
  card: { ko: "카드 포장", zh: "卡片包装", Icon: CreditCard },
  set: { ko: "세트 포장", zh: "套装包装", Icon: Package },
  courier: { ko: "택배 포장", zh: "快递包装", Icon: Mail },
  invoice: { ko: "송장 부착", zh: "运单贴附", Icon: Truck },
  done: { ko: "완료", zh: "完成", Icon: CheckCircle2 },
};

export default function ProductionMonitor() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "pipeline");
  useEffect(() => { const t = searchParams.get("tab"); if (t) setTab(t); }, [searchParams]);

  const { data: orders } = useOrders();
  const { data: tracking } = useProductionTracking();
  const { data: shipments } = useShipments();

  const [stageDetail, setStageDetail] = useState<{ orderId: string; stage: StageKey } | null>(null);

  const detailOrder = stageDetail ? orders?.find(o => o.id === stageDetail.orderId) : null;
  const detailTracking = useMemo(() => {
    if (!stageDetail) return [];
    return (tracking ?? []).filter(t => t.order_id === stageDetail.orderId && t.stage === stageDetail.stage);
  }, [tracking, stageDetail]);
  const detailShipments = useMemo(() => {
    if (!stageDetail) return [];
    return (shipments ?? []).filter(s => s.order_id === stageDetail.orderId);
  }, [shipments, stageDetail]);

  const meta = stageDetail ? stageMeta[stageDetail.stage] : null;
  const stageLabel = meta ? (isKo ? meta.ko : meta.zh) : "";

  const orderQty = detailOrder?.quantity ?? 0;
  const stageDone = detailTracking.reduce((s, t) => s + (t.completed_count ?? 0), 0);
  const stageFail = detailTracking.reduce((s, t) => s + ((t as any).failed_count ?? 0), 0);

  return (
    <div>
      <PageHeader title={t("monitor.title")} description={t("monitor.desc")} />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="pipeline" className="gap-1.5"><Activity className="w-3.5 h-3.5" />{t("monitor.tab.pipeline")}</TabsTrigger>
            <TabsTrigger value="machines" className="gap-1.5"><Gauge className="w-3.5 h-3.5" />{t("monitor.tab.machines")}</TabsTrigger>
            <TabsTrigger value="cctv" className="gap-1.5"><Video className="w-3.5 h-3.5" />{isKo ? "CCTV 모니터링" : "CCTV监控"}</TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline" className="space-y-6">
            <OrderPipeline onStageClick={(orderId, stage) => setStageDetail({ orderId, stage: stage as StageKey })} />
          </TabsContent>

          <TabsContent value="machines" className="space-y-6">
            <div className="kpi-card py-12 text-center text-muted-foreground">
              <Gauge className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{isKo ? "PLC/게이트웨이 연동 후 기계 상태가 실시간으로 표시됩니다" : "PLC/网关连接后将实时显示设备状态"}</p>
              <p className="text-xs mt-2 text-muted-foreground/60">{isKo ? "시스템 설정 → 장비 관리에서 장비를 등록해주세요" : "请在系统设置 → 设备管理中注册设备"}</p>
            </div>
          </TabsContent>

          <TabsContent value="cctv" className="space-y-6">
            <CctvMonitor />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!stageDetail} onOpenChange={(v) => { if (!v) setStageDetail(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {meta && <meta.Icon className="w-4 h-4" />}
              {stageLabel} {detailOrder && <span className="text-xs text-muted-foreground font-normal">· {detailOrder.external_order_id}</span>}
            </DialogTitle>
          </DialogHeader>

          {detailOrder && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <div className="kpi-card text-center py-3">
                  <p className="text-xl font-semibold tabular-nums">{stageDone}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{isKo ? "완료" : "完成"}</p>
                </div>
                <div className="kpi-card text-center py-3">
                  <p className="text-xl font-semibold tabular-nums">{Math.max(0, orderQty - stageDone)}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{isKo ? "대기" : "待处理"}</p>
                </div>
                <div className="kpi-card text-center py-3">
                  <p className="text-xl font-semibold tabular-nums text-destructive">{stageFail}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{isKo ? "불량" : "不良"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">{isKo ? "주문번호" : "订单号"}</span><span className="font-medium">{detailOrder.external_order_id}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{isKo ? "수량" : "数量"}</span><span className="font-medium tabular-nums">{orderQty}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{isKo ? "트윈커" : "Twinker"}</span><span className="font-medium">{detailOrder.recipient_name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{isKo ? "국가" : "国家"}</span><span className="font-medium">{detailOrder.shipping_country}</span></div>
              </div>

              {/* Stage-specific content */}
              {stageDetail && ["card", "set", "courier", "invoice"].includes(stageDetail.stage) && (
                <div>
                  <p className="text-xs font-medium mb-2 text-muted-foreground">
                    {stageDetail.stage === "card" && (isKo ? "카드 포장 로그" : "卡片包装日志")}
                    {stageDetail.stage === "set" && (isKo ? "세트 매칭 로그" : "套装匹配日志")}
                    {stageDetail.stage === "courier" && (isKo ? "택배 포장 로그" : "快递包装日志")}
                    {stageDetail.stage === "invoice" && (isKo ? "송장/출고 정보" : "运单/出库信息")}
                  </p>
                  {(stageDetail.stage === "courier" || stageDetail.stage === "invoice") ? (
                    detailShipments.length === 0 ? (
                      <div className="border rounded p-4 text-center text-xs text-muted-foreground">
                        <Printer className="w-5 h-5 mx-auto mb-2 opacity-40" />
                        {isKo ? "출고 데이터가 없습니다" : "暂无出库数据"}
                      </div>
                    ) : (
                      <div className="border rounded overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40">
                            <tr className="text-left">
                              <th className="px-2 py-1.5">{isKo ? "세트ID" : "套装ID"}</th>
                              <th className="px-2 py-1.5">{isKo ? "운송장" : "运单号"}</th>
                              <th className="px-2 py-1.5">{isKo ? "상태" : "状态"}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailShipments.map(s => (
                              <tr key={s.id} className="border-t">
                                <td className="px-2 py-1.5 font-mono">{s.set_id ?? "-"}</td>
                                <td className="px-2 py-1.5 font-mono">{s.tracking_number ?? "-"}</td>
                                <td className="px-2 py-1.5">{s.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : detailTracking.length === 0 ? (
                    <div className="border rounded p-4 text-center text-xs text-muted-foreground">
                      {stageDetail.stage === "card" && <ScanLine className="w-5 h-5 mx-auto mb-2 opacity-40" />}
                      {stageDetail.stage === "set" && <Package className="w-5 h-5 mx-auto mb-2 opacity-40" />}
                      {isKo ? "작업이 진행되면 실시간 로그가 표시됩니다" : "作业进行后将显示实时日志"}
                    </div>
                  ) : (
                    <div className="border rounded overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr className="text-left">
                            <th className="px-2 py-1.5">{isKo ? "시간" : "时间"}</th>
                            <th className="px-2 py-1.5">{isKo ? "완료" : "完成"}</th>
                            <th className="px-2 py-1.5">{isKo ? "불량" : "不良"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailTracking.map(tr => (
                            <tr key={tr.id} className="border-t">
                              <td className="px-2 py-1.5">{new Date(tr.created_at).toLocaleString(isKo ? "ko-KR" : "zh-CN")}</td>
                              <td className="px-2 py-1.5 tabular-nums">{tr.completed_count}</td>
                              <td className="px-2 py-1.5 tabular-nums">{(tr as any).failed_count ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
