import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Printer, Search, ShieldCheck, AlertTriangle, Scale, ScanLine, CheckCircle2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Badge } from "@/components/ui/badge";

export default function Shipping() {
  const { t, lang } = useLang();
  const isKo = lang !== "zh";

  const shipments = [
    { order: "ORD-24831", setId: "SET-20240315-0312", recipient: isKo ? "홍길동" : "洪吉童", phone: "010-****-5678", address: isKo ? "서울시 강남구 역삼동 123-4" : "首尔市江南区驿三洞123-4", product: "BT-2024-A", invoice: "CJ-123456789", status: "shipDone", inspectMatch: true, inspectWeight: true, inspectStatus: "pass" },
    { order: "ORD-24832", setId: "SET-20240315-0311", recipient: isKo ? "김철수" : "金哲秀", phone: "010-****-1234", address: isKo ? "경기도 성남시 분당구 판교로 45" : "京畿道城南市盆唐区板桥路45", product: "BT-2024-A", invoice: "-", status: "invoiceWait", inspectMatch: false, inspectWeight: false, inspectStatus: "pending" },
    { order: "ORD-24833", setId: "SET-20240315-0310", recipient: isKo ? "이영희" : "李英姬", phone: "010-****-9012", address: isKo ? "부산시 해운대구 우동 567" : "釜山市海云台区佑洞567", product: "BT-2024-B", invoice: "CJ-123456790", status: "shipDone", inspectMatch: true, inspectWeight: false, inspectStatus: "weightFail" },
    { order: "ORD-24834", setId: "SET-20240315-0309", recipient: isKo ? "박지민" : "朴智敏", phone: "010-****-3456", address: isKo ? "대전시 유성구 봉명동 89" : "大田市儒城区凤鸣洞89", product: "BT-2024-A", invoice: "CJ-123456791", status: "shipDone", inspectMatch: false, inspectWeight: true, inspectStatus: "mismatch" },
  ];

  const statusLabel: Record<string, string> = {
    invoiceWait: t("status.invoiceWait"), invoiceDone: t("status.invoiceDone"), shipDone: t("status.shipDone"), shipHold: t("status.shipHold"),
  };
  const statusBadge: Record<string, string> = {
    invoiceWait: "status-idle", invoiceDone: "status-warning", shipDone: "status-running", shipHold: "status-stopped",
  };

  const inspectLabels: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    pass: { label: isKo ? "검수통과" : "检验通过", variant: "default" },
    mismatch: { label: isKo ? "매칭불일치" : "匹配不一致", variant: "destructive" },
    weightFail: { label: isKo ? "중량이상" : "重量异常", variant: "destructive" },
    pending: { label: isKo ? "검수대기" : "待检验", variant: "secondary" },
  };

  const passCount = shipments.filter(s => s.inspectStatus === "pass").length;
  const failCount = shipments.filter(s => ["mismatch", "weightFail"].includes(s.inspectStatus)).length;

  return (
    <div>
      <PageHeader title={t("shipping.title")} description={t("shipping.desc")}>
        <Button size="sm" variant="outline" className="gap-1.5"><Printer className="w-4 h-4" /> {t("shipping.batchPrint")}</Button>
      </PageHeader>
      <div className="p-6 space-y-6">
        {/* 검수 KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 section-enter">
          {[
            { label: isKo ? "출고 완료" : "已出库", value: shipments.filter(s => s.status === "shipDone").length, icon: CheckCircle2, color: "text-primary" },
            { label: isKo ? "송장 대기" : "待打印运单", value: shipments.filter(s => s.status === "invoiceWait").length, icon: Printer, color: "text-muted-foreground" },
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

        {/* 검수 기준 안내 */}
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

        {/* 출고 테이블 + 검수 결과 */}
        <div className="kpi-card section-enter" style={{ animationDelay: "250ms" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("shipping.search")} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {[
                    t("shipping.orderNo"), t("shipping.setId"), t("shipping.recipient"), t("shipping.phone"),
                    t("shipping.address"), t("shipping.product"), t("shipping.invoiceNo"), t("shipping.status"),
                    isKo ? "QR↔송장" : "QR↔运单",
                    isKo ? "중량" : "重量",
                    isKo ? "검수" : "检验", "",
                  ].map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-3">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => (
                  <tr key={s.order} className={`border-b last:border-0 ${["mismatch", "weightFail"].includes(s.inspectStatus) ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                    <td className="py-2.5 font-medium text-primary pr-3">{s.order}</td>
                    <td className="py-2.5 font-mono text-xs pr-3">{s.setId}</td>
                    <td className="py-2.5 pr-3">{s.recipient}</td>
                    <td className="py-2.5 text-muted-foreground pr-3">{s.phone}</td>
                    <td className="py-2.5 pr-3 max-w-[180px] truncate">{s.address}</td>
                    <td className="py-2.5 pr-3">{s.product}</td>
                    <td className="py-2.5 font-mono text-xs pr-3">{s.invoice}</td>
                    <td className="py-2.5 pr-3"><span className={`status-badge ${statusBadge[s.status]}`}>{statusLabel[s.status]}</span></td>
                    <td className="py-2.5 pr-3">
                      {s.inspectStatus !== "pending" ? (
                        s.inspectMatch ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-destructive" />
                      ) : <span className="text-xs text-muted-foreground">-</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {s.inspectStatus !== "pending" ? (
                        s.inspectWeight ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertTriangle className="w-4 h-4 text-destructive" />
                      ) : <span className="text-xs text-muted-foreground">-</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={inspectLabels[s.inspectStatus]?.variant || "secondary"} className="text-xs">
                        {inspectLabels[s.inspectStatus]?.label || s.inspectStatus}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      {s.status === "invoiceWait" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Printer className="w-3 h-3" /> {t("shipping.print")}</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
