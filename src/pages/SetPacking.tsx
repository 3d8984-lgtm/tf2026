import PageHeader from "@/components/PageHeader";
import { CheckCircle2, XCircle, Package, Scale, ShieldCheck, AlertTriangle } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Badge } from "@/components/ui/badge";

const setLogs = [
  { time: "14:37:01", setId: "SET-20240315-0312", tshirtQR: "DQR-00482", cardQR: "CPQ-0482", product: "BT-2024-A", design: "DSN-047", match: true, weight: 285, weightOk: true, inspectStatus: "pass" },
  { time: "14:36:38", setId: "SET-20240315-0311", tshirtQR: "DQR-00481", cardQR: "CPQ-0481", product: "BT-2024-A", design: "DSN-047", match: true, weight: 282, weightOk: true, inspectStatus: "pass" },
  { time: "14:36:12", setId: "-", tshirtQR: "DQR-00480", cardQR: "CPQ-0478", product: "BT-2024-A / BT-2024-B", design: "DSN-047 / DSN-012", match: false, weight: 0, weightOk: false, inspectStatus: "matchFail" },
  { time: "14:35:50", setId: "SET-20240315-0310", tshirtQR: "DQR-00479", cardQR: "CPQ-0479", product: "BT-2024-B", design: "DSN-012", match: true, weight: 310, weightOk: false, inspectStatus: "weightFail" },
  { time: "14:35:22", setId: "SET-20240315-0309", tshirtQR: "DQR-00478", cardQR: "CPQ-0478", product: "BT-2024-A", design: "DSN-047", match: true, weight: 288, weightOk: true, inspectStatus: "pass" },
];

export default function SetPacking() {
  const { t, lang } = useLang();
  const isKo = lang !== "zh";

  const inspectLabels: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    pass: { label: isKo ? "검수통과" : "检验通过", variant: "default" },
    matchFail: { label: isKo ? "매칭실패" : "匹配失败", variant: "destructive" },
    weightFail: { label: isKo ? "중량이상" : "重量异常", variant: "destructive" },
  };

  const passCount = setLogs.filter(l => l.inspectStatus === "pass").length;
  const failCount = setLogs.filter(l => l.inspectStatus !== "pass").length;

  return (
    <div>
      <PageHeader title={t("setPacking.title")} description={t("setPacking.desc")} />
      <div className="p-6 space-y-6">
        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: t("setPacking.matchWait"), value: 178, icon: Package },
            { label: t("setPacking.packDone"), value: 654, icon: CheckCircle2 },
            { label: t("setPacking.matchFail"), value: 3, icon: XCircle },
            { label: isKo ? "검수 통과" : "检验通过", value: passCount, icon: ShieldCheck },
            { label: isKo ? "검수 실패" : "检验失败", value: failCount, icon: AlertTriangle },
          ].map((s, i) => (
            <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex justify-center mb-1">
                <s.icon className={`w-4 h-4 ${i >= 3 ? (i === 3 ? "text-success" : "text-destructive") : "text-primary"}`} />
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
            {isKo ? "세트 포장 검수 기준" : "套装包装检验标准"}
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="p-1.5 rounded-md bg-primary/10">
                <CheckCircle2 className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{isKo ? "QR 매칭 이중 검증" : "QR匹配双重验证"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isKo ? "티셔츠 QR + 카드 QR 동시 스캔 → 상품코드·디자인코드 일치 확인" : "T恤QR + 卡片QR同时扫描 → 确认商品代码·设计代码一致"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="p-1.5 rounded-md bg-primary/10">
                <Scale className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{isKo ? "중량 검사 (자동)" : "重量检测（自动）"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isKo ? "티셔츠+카드 합산 기준 중량 범위(270~300g) 자동 체크, 이상 시 자동 배출" : "T恤+卡片合计基准重量范围(270~300g)自动检测，异常时自动排出"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 매칭 로그 + 검수 결과 */}
        <div className="kpi-card section-enter" style={{ animationDelay: "250ms" }}>
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
            <Package className="w-4 h-4" />
            {t("setPacking.matchLog")} + {isKo ? "검수 결과" : "检验结果"}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {[
                    t("setPacking.time"), t("setPacking.setId"), t("setPacking.tshirtQR"), t("setPacking.cardQR"),
                    t("setPacking.productCode"), t("setPacking.designCode"), t("setPacking.match"),
                    isKo ? "중량(g)" : "重量(g)", isKo ? "검수 결과" : "检验结果",
                  ].map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {setLogs.map((l, i) => (
                  <tr key={i} className={`border-b last:border-0 ${l.inspectStatus !== "pass" ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                    <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{l.time}</td>
                    <td className="py-2.5 font-medium pr-4">{l.setId !== "-" ? <span className="text-primary">{l.setId}</span> : "-"}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.tshirtQR}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{l.cardQR}</td>
                    <td className="py-2.5 pr-4">{l.product}</td>
                    <td className="py-2.5 pr-4">{l.design}</td>
                    <td className="py-2.5 pr-4">{l.match ? <CheckCircle2 className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-destructive" />}</td>
                    <td className="py-2.5 pr-4">
                      {l.weight > 0 ? (
                        <span className={`tabular-nums ${l.weightOk ? "" : "text-destructive font-medium"}`}>
                          {l.weight}g {!l.weightOk && "⚠"}
                        </span>
                      ) : "-"}
                    </td>
                    <td className="py-2.5">
                      <Badge variant={inspectLabels[l.inspectStatus]?.variant || "secondary"} className="text-xs">
                        {inspectLabels[l.inspectStatus]?.label || l.inspectStatus}
                      </Badge>
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
