import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Printer, Search, ShieldCheck, AlertTriangle, CheckCircle2, Edit,
  Package, Truck, ChevronDown, ChevronRight, ChevronLeft, Send, RefreshCw, CheckCheck,
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Badge } from "@/components/ui/badge";
import { useShippingGrouped, useShippingKpis } from "@/hooks/useShippingData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import type { Database } from "@/integrations/supabase/types";

type ShipmentStatus = Database["public"]["Enums"]["shipment_status"];

const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "pending", "label_requested", "label_received", "packed",
  "shipped", "in_transit", "delivered", "hold",
];

const PAGE_SIZE = 10;

export default function Shipping() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "all">("all");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEditShipping, canTwinmetaSync } = usePermissions();

  const { data: kpis } = useShippingKpis();
  const { data, isLoading } = useShippingGrouped({ status: statusFilter, search, page, pageSize: PAGE_SIZE });

  const totalPages = Math.ceil((data?.totalOrders ?? 0) / PAGE_SIZE);

  const shipmentStatusLabel: Record<string, string> = {
    pending: isKo ? "대기" : "待处理",
    label_requested: isKo ? "라벨 요청" : "标签请求中",
    label_received: isKo ? "라벨 수신" : "标签已收",
    packed: isKo ? "포장완료" : "已包装",
    shipped: isKo ? "발송완료" : "已发货",
    in_transit: isKo ? "배송중" : "运输中",
    delivered: isKo ? "배달완료" : "已送达",
    hold: isKo ? "보류" : "暂停",
  };

  const shipmentStatusCls: Record<string, string> = {
    pending: "status-idle",
    label_requested: "status-idle",
    label_received: "status-warning",
    packed: "status-warning",
    shipped: "status-running",
    in_transit: "status-running",
    delivered: "status-running",
    hold: "status-stopped",
  };

  return (
    <div>
      <PageHeader title={t("shipping.title")} description={t("shipping.desc")}>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Printer className="w-4 h-4" /> {t("shipping.batchPrint")}
        </Button>
      </PageHeader>
      <div className="p-6 space-y-6">
        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 section-enter">
          {[
            { label: isKo ? "출고 완료" : "已出库", value: kpis?.shippedCount ?? 0, icon: CheckCircle2, color: "text-primary" },
            { label: isKo ? "송장 대기" : "待打印运单", value: kpis?.pendingCount ?? 0, icon: Printer, color: "text-muted-foreground" },
            { label: isKo ? "검수 통과" : "检验通过", value: kpis?.passCount ?? 0, icon: ShieldCheck, color: "text-success" },
            { label: isKo ? "검수 실패" : "检验失败", value: kpis?.failCount ?? 0, icon: AlertTriangle, color: "text-destructive" },
          ].map((s, i) => (
            <div key={s.label} className="kpi-card text-center" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex justify-center mb-1">
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm"
              placeholder={isKo ? "주문번호/수취인 검색" : "搜索订单号/收件人"}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as ShipmentStatus | "all"); setPage(1); }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isKo ? "전체 상태" : "全部状态"}</SelectItem>
              {SHIPMENT_STATUSES.map(st => (
                <SelectItem key={st} value={st}>{shipmentStatusLabel[st]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Order groups */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-3">
            {data?.groups.map((group) => (
              <OrderGroup
                key={group.orderId}
                group={group}
                isKo={isKo}
                shipmentStatusLabel={shipmentStatusLabel}
                shipmentStatusCls={shipmentStatusCls}
                queryClient={queryClient}
                toast={toast}
                canEdit={canEditShipping}
                canSync={canTwinmetaSync}
              />
            ))}
            {(data?.groups.length ?? 0) === 0 && (
              <div className="kpi-card py-12 text-center text-muted-foreground">
                {isKo ? "출고 데이터가 없습니다" : "暂无出库数据"}
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline" size="sm" disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline" size="sm" disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Order Group Accordion ─── */

interface OrderGroupProps {
  group: {
    orderId: string;
    displayOrder: string;
    externalOrderId: string;
    recipientName: string;
    productCode: string;
    quantity: number;
    dueDate: string | null;
    shippingCity: string | null;
    shippingState: string | null;
    shipments: Database["public"]["Tables"]["shipments"]["Row"][];
    summary: { pass: number; fail: number; pending: number; shipped: number; total: number };
  };
  isKo: boolean;
  shipmentStatusLabel: Record<string, string>;
  shipmentStatusCls: Record<string, string>;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
  canEdit: boolean;
  canSync: boolean;
}

function OrderGroup({ group, isKo, shipmentStatusLabel, shipmentStatusCls, queryClient, toast, canEdit, canSync }: OrderGroupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTrackingNumber, setEditTrackingNumber] = useState("");
  const [editCarrier, setEditCarrier] = useState("");
  const [editStatus, setEditStatus] = useState<ShipmentStatus>("pending");
  const [saving, setSaving] = useState(false);

  const shippedPct = group.summary.total === 0 ? 0 : Math.round((group.summary.shipped / group.summary.total) * 100);

  const inspectLabels: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    pass: { label: isKo ? "검수통과" : "检验通过", variant: "default" },
    mismatch: { label: isKo ? "매칭불일치" : "匹配不一致", variant: "destructive" },
    weight_fail: { label: isKo ? "중량이상" : "重量异常", variant: "destructive" },
    pending: { label: isKo ? "검수대기" : "待检验", variant: "secondary" },
  };

  const openEdit = (shipment: Database["public"]["Tables"]["shipments"]["Row"]) => {
    setEditingId(shipment.id);
    setEditTrackingNumber(shipment.tracking_number ?? "");
    setEditCarrier(shipment.carrier ?? "");
    setEditStatus(shipment.status);
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const updateData: Record<string, unknown> = {
        tracking_number: editTrackingNumber.trim() || null,
        carrier: editCarrier.trim() || "manual",
        status: editStatus,
      };
      if (editStatus === "shipped") updateData.shipped_at = new Date().toISOString();
      if (editStatus === "delivered") updateData.delivered_at = new Date().toISOString();

      const { error } = await supabase.from("shipments").update(updateData).eq("id", editingId);
      if (error) throw error;

      toast({ title: isKo ? "저장 완료" : "保存成功", description: isKo ? "배송 정보가 업데이트되었습니다" : "配送信息已更新" });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["shipping_grouped"] });
      queryClient.invalidateQueries({ queryKey: ["shipping_kpis"] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: isKo ? "오류" : "错误", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="kpi-card section-enter">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <span className="font-semibold text-sm">{group.displayOrder}</span>
          <span className="text-xs text-muted-foreground">{group.recipientName}</span>
          {group.dueDate && (
            <span className="text-xs text-muted-foreground">{isKo ? "납기" : "交期"}: {group.dueDate}</span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{isKo ? "건수" : "件数"}: {group.summary.total}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs tabular-nums text-muted-foreground">{group.summary.shipped}/{group.summary.total}</span>
          <div className="w-20 h-1.5 rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(shippedPct, 100)}%`,
                background: shippedPct >= 100 ? "hsl(var(--success))" : "hsl(var(--primary))",
              }}
            />
          </div>
          <span className="text-xs font-medium tabular-nums">{shippedPct}%</span>
          {group.summary.fail > 0 && (
            <span className="status-badge status-stopped">{isKo ? "검수실패" : "检验失败"} {group.summary.fail}</span>
          )}
        </div>
      </button>

      {isOpen && (
        <div className="mt-4 pt-4 border-t">
          {/* Mini stats */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-1.5 text-xs">
              <Package className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{isKo ? "검수대기" : "待检验"}</span>
              <span className="font-semibold tabular-nums">{group.summary.pending}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className="text-muted-foreground">{isKo ? "검수통과" : "检验通过"}</span>
              <span className="font-semibold tabular-nums">{group.summary.pass}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
              <span className="text-muted-foreground">{isKo ? "검수실패" : "检验失败"}</span>
              <span className="font-semibold tabular-nums">{group.summary.fail}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Truck className="w-3.5 h-3.5 text-primary" />
              <span className="text-muted-foreground">{isKo ? "출고완료" : "已出库"}</span>
              <span className="font-semibold tabular-nums">{group.summary.shipped}</span>
            </div>
          </div>

          {/* Shipments table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {[
                    isKo ? "세트ID" : "套装ID",
                    isKo ? "택배사" : "快递公司",
                    isKo ? "운송장" : "运单号",
                    isKo ? "상태" : "状态",
                    isKo ? "QR매칭" : "QR匹配",
                    isKo ? "중량" : "重量",
                    isKo ? "검수" : "检验",
                    isKo ? "TWINMETA" : "TWINMETA",
                    isKo ? "관리" : "管理",
                  ].map(h => (
                    <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.shipments.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-b last:border-0 ${["mismatch", "weight_fail"].includes(s.inspect_result) ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}
                  >
                    <td className="py-2.5 font-mono text-xs pr-3">{s.set_id ?? "-"}</td>
                    <td className="py-2.5 pr-3 uppercase text-xs font-medium">{s.carrier}</td>
                    <td className="py-2.5 font-mono text-xs pr-3">
                      {s.tracking_number ?? <span className="text-muted-foreground italic">{isKo ? "미입력" : "未输入"}</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`status-badge ${shipmentStatusCls[s.status] ?? "status-idle"}`}>
                        {shipmentStatusLabel[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {s.inspect_qr_match !== null ? (
                        s.inspect_qr_match ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-destructive" />
                      ) : <span className="text-xs text-muted-foreground">-</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {s.inspect_weight !== null ? (
                        s.inspect_weight ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-destructive" />
                      ) : <span className="text-xs text-muted-foreground">-</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={inspectLabels[s.inspect_result]?.variant ?? "secondary"} className="text-xs">
                        {inspectLabels[s.inspect_result]?.label ?? s.inspect_result}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3">
                      {canSync ? (
                        <SyncStatusCell shipment={s} isKo={isKo} queryClient={queryClient} toast={toast} />
                      ) : (
                        s.synced_to_source
                          ? <Badge variant="outline" className="text-xs gap-1 border-emerald-200 text-emerald-700"><CheckCheck className="w-3 h-3" />{isKo ? "전송됨" : "已发送"}</Badge>
                          : <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {canEdit && (
                        <Dialog open={editingId === s.id} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(s)}>
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <Truck className="w-4 h-4" />
                                {isKo ? "배송 정보 수정" : "修改配送信息"}
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                              <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                                <p><span className="text-muted-foreground">{isKo ? "주문번호:" : "订单号:"}</span> <span className="font-medium">{group.externalOrderId}</span></p>
                                <p><span className="text-muted-foreground">{isKo ? "수취인:" : "收件人:"}</span> <span className="font-medium">{group.recipientName}</span></p>
                              </div>
                              <div className="space-y-2">
                                <Label>{isKo ? "택배사" : "快递公司"}</Label>
                                <Input value={editCarrier} onChange={e => setEditCarrier(e.target.value)} placeholder={isKo ? "예: CJ대한통운, 4PX, UPS" : "例: 顺丰, 4PX, UPS"} />
                              </div>
                              <div className="space-y-2">
                                <Label>{isKo ? "운송장 번호" : "运单号"}</Label>
                                <Input value={editTrackingNumber} onChange={e => setEditTrackingNumber(e.target.value)} placeholder={isKo ? "운송장 번호 입력" : "输入运单号"} />
                              </div>
                              <div className="space-y-2">
                                <Label>{isKo ? "배송 상태" : "配送状态"}</Label>
                                <Select value={editStatus} onValueChange={(v) => setEditStatus(v as ShipmentStatus)}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {SHIPMENT_STATUSES.map(st => (
                                      <SelectItem key={st} value={st}>{shipmentStatusLabel[st] ?? st}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex justify-end gap-2 pt-2">
                                <Button variant="outline" onClick={() => setEditingId(null)} disabled={saving}>
                                  {isKo ? "취소" : "取消"}
                                </Button>
                                <Button onClick={handleSave} disabled={saving} className="gap-1.5">
                                  <Package className="w-4 h-4" />
                                  {saving ? (isKo ? "저장중..." : "保存中...") : (isKo ? "저장" : "保存")}
                                </Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </td>
                  </tr>
                ))}
                {group.shipments.length === 0 && (
                  <tr><td colSpan={9} className="py-4 text-center text-muted-foreground text-sm">{isKo ? "배송 데이터가 없습니다" : "暂无配送数据"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sync Status Cell ─── */

function SyncStatusCell({
  shipment,
  isKo,
  queryClient,
  toast,
}: {
  shipment: Database["public"]["Tables"]["shipments"]["Row"];
  isKo: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [syncing, setSyncing] = useState(false);

  if (!shipment.tracking_number) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  if (shipment.synced_to_source) {
    return (
      <Badge variant="outline" className="text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
        <CheckCheck className="w-3 h-3" />
        {isKo ? "전송됨" : "已发送"}
      </Badge>
    );
  }

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("site-a-callback", {
        body: { shipment_id: shipment.id, event: "tracking_update" },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: isKo ? "전송 완료" : "发送成功", description: isKo ? "TWINMETA 사이트로 송장번호가 전송되었습니다" : "运单号已发送到TWINMETA站点" });
      } else {
        toast({ title: isKo ? "전송 실패" : "发送失败", description: data?.error || "Unknown error", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["shipping_grouped"] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: isKo ? "오류" : "错误", description: msg, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={handleManualSync} disabled={syncing}>
      {syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
      {isKo ? "전송" : "发送"}
    </Button>
  );
}
