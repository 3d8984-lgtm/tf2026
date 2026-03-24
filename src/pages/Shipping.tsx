import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Printer, Search, ShieldCheck, AlertTriangle, Scale, ScanLine, CheckCircle2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Badge } from "@/components/ui/badge";
import { useShipments } from "@/hooks/useDbData";
import { useState } from "react";

export default function Shipping() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [search, setSearch] = useState("");

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
                      <td className="py-2.5 font-mono text-xs pr-3">{s.tracking_number ?? "-"}</td>
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
                      <td className="py-2.5">
                        <Badge variant={inspectLabels[s.inspect_result]?.variant ?? "secondary"} className="text-xs">
                          {inspectLabels[s.inspect_result]?.label ?? s.inspect_result}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={11} className="py-8 text-center text-muted-foreground">{isKo ? "출고 데이터가 없습니다" : "暂无出库数据"}</td></tr>
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
