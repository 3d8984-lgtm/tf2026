import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Printer, Search, ShieldCheck, AlertTriangle, Scale, ScanLine,
  CheckCircle2, Edit, Package, Truck
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Badge } from "@/components/ui/badge";
import { useShipments } from "@/hooks/useDbData";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

type ShipmentStatus = Database["public"]["Enums"]["shipment_status"];

const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "pending", "label_requested", "label_received", "packed",
  "shipped", "in_transit", "delivered", "hold",
];

export default function Shipping() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTrackingNumber, setEditTrackingNumber] = useState("");
  const [editCarrier, setEditCarrier] = useState("");
  const [editStatus, setEditStatus] = useState<ShipmentStatus>("pending");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: shipments, isLoading } = useShipments();

  const inspectLabels: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    pass: { label: isKo ? "검수통과" : "检验通过", variant: "default" },
    mismatch: { label: isKo ? "매칭불일치" : "匹配不一致", variant: "destructive" },
    weight_fail: { label: isKo ? "중량이상" : "重量异常", variant: "destructive" },
    pending: { label: isKo ? "검수대기" : "待检验", variant: "secondary" },
  };

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

  const filtered = shipments?.filter(s =>
    !search ||
    (s.orders?.external_order_id ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (s.orders?.recipient_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (s.tracking_number ?? "").toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const passCount = shipments?.filter(s => s.inspect_result === "pass").length ?? 0;
  const failCount = shipments?.filter(s => ["mismatch", "weight_fail"].includes(s.inspect_result)).length ?? 0;
  const shippedCount = shipments?.filter(s => ["shipped", "in_transit", "delivered"].includes(s.status)).length ?? 0;
  const pendingCount = shipments?.filter(s => s.status === "pending").length ?? 0;

  const openEdit = (shipment: NonNullable<typeof shipments>[number]) => {
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
      if (editStatus === "shipped" && !filtered.find(s => s.id === editingId && s.shipped_at)) {
        updateData.shipped_at = new Date().toISOString();
      }
      if (editStatus === "delivered") {
        updateData.delivered_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("shipments")
        .update(updateData)
        .eq("id", editingId);

      if (error) throw error;

      toast({
        title: isKo ? "저장 완료" : "保存成功",
        description: isKo ? "배송 정보가 업데이트되었습니다" : "配送信息已更新",
      });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: isKo ? "오류" : "错误", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title={t("shipping.title")} description={t("shipping.desc")}>
        <Button size="sm" variant="outline" className="gap-1.5"><Printer className="w-4 h-4" /> {t("shipping.batchPrint")}</Button>
      </PageHeader>
      <div className="p-6 space-y-6">
        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 section-enter">
          {[
            { label: isKo ? "출고 완료" : "已出库", value: shippedCount, icon: CheckCircle2, color: "text-primary" },
            { label: isKo ? "송장 대기" : "待打印运单", value: pendingCount, icon: Printer, color: "text-muted-foreground" },
            { label: isKo ? "검수 통과" : "检验通过", value: passCount, icon: ShieldCheck, color: "text-success" },
            { label: isKo ? "검수 실패" : "检验失败", value: failCount, icon: AlertTriangle, color: "text-destructive" },
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

        {/* Inspection standards */}
        <div className="kpi-card section-enter p-4" style={{ animationDelay: "150ms" }}>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            {isKo ? "택배 출고 검수 기준" : "快递出库检验标准"}
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="p-1.5 rounded-md bg-primary/10">
                <ScanLine className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{isKo ? "세트QR ↔ 송장 매칭 스캔" : "套装QR ↔ 运单匹配扫描"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isKo ? "세트 QR 스캔 후 송장 바코드 스캔 → 수취인·주문 정보 자동 매칭 확인" : "扫描套装QR后扫描运单条码 → 自动匹配确认收件人·订单信息"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="p-1.5 rounded-md bg-primary/10">
                <Scale className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{isKo ? "중량 검사 (선택)" : "重量检测（可选）"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isKo ? "택배 봉투 포장 후 중량 체크 → 빈 봉투/이중 포장 방지" : "快递袋包装后重量检测 → 防止空袋/重复包装"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="kpi-card section-enter" style={{ animationDelay: "250ms" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("shipping.search")} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    {[
                      t("shipping.orderNo"), t("shipping.setId"), t("shipping.recipient"),
                      isKo ? "배송지" : "配送地址", t("shipping.product"),
                      isKo ? "택배사" : "快递公司", t("shipping.invoiceNo"), t("shipping.status"),
                      isKo ? "QR매칭" : "QR匹配", isKo ? "중량" : "重量", isKo ? "검수" : "检验",
                      isKo ? "관리" : "管理",
                    ].map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-3">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className={`border-b last:border-0 ${["mismatch", "weight_fail"].includes(s.inspect_result) ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                      <td className="py-2.5 font-medium text-primary pr-3">{s.orders?.external_order_id ?? "-"}</td>
                      <td className="py-2.5 font-mono text-xs pr-3">{s.set_id ?? "-"}</td>
                      <td className="py-2.5 pr-3">{s.orders?.recipient_name ?? "-"}</td>
                      <td className="py-2.5 pr-3 max-w-[180px] truncate text-muted-foreground">
                        {[s.orders?.shipping_city, s.orders?.shipping_state].filter(Boolean).join(", ")}
                      </td>
                      <td className="py-2.5 pr-3">{s.orders?.product_code ?? "-"}</td>
                      <td className="py-2.5 pr-3 uppercase text-xs font-medium">{s.carrier}</td>
                      <td className="py-2.5 font-mono text-xs pr-3">{s.tracking_number ?? <span className="text-muted-foreground italic">{isKo ? "미입력" : "未输入"}</span>}</td>
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
                      <td className="py-2.5">
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
                                <p><span className="text-muted-foreground">{isKo ? "주문번호:" : "订单号:"}</span> <span className="font-medium">{s.orders?.external_order_id}</span></p>
                                <p><span className="text-muted-foreground">{isKo ? "수취인:" : "收件人:"}</span> <span className="font-medium">{s.orders?.recipient_name}</span></p>
                                <p><span className="text-muted-foreground">{isKo ? "상품:" : "商品:"}</span> <span className="font-medium">{s.orders?.product_code}</span></p>
                              </div>

                              <div className="space-y-2">
                                <Label>{isKo ? "택배사" : "快递公司"}</Label>
                                <Input
                                  value={editCarrier}
                                  onChange={e => setEditCarrier(e.target.value)}
                                  placeholder={isKo ? "예: CJ대한통운, 4PX, UPS" : "例: 顺丰, 4PX, UPS"}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label>{isKo ? "운송장 번호" : "运单号"}</Label>
                                <Input
                                  value={editTrackingNumber}
                                  onChange={e => setEditTrackingNumber(e.target.value)}
                                  placeholder={isKo ? "운송장 번호 입력" : "输入运单号"}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label>{isKo ? "배송 상태" : "配送状态"}</Label>
                                <Select value={editStatus} onValueChange={(v) => setEditStatus(v as ShipmentStatus)}>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SHIPMENT_STATUSES.map(st => (
                                      <SelectItem key={st} value={st}>
                                        {shipmentStatusLabel[st] ?? st}
                                      </SelectItem>
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
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={12} className="py-8 text-center text-muted-foreground">{isKo ? "출고 데이터가 없습니다" : "暂无出库数据"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
