import PageHeader from "@/components/PageHeader";
import { AlertTriangle, XCircle, Camera, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";

export default function Defects() {
  const { t, lang } = useLang();

  const defects = [
    { id: "EX-0231", type: t("defects.qrMismatch"), process: t("process.tshirt"), detail: lang === "ko" ? "실리콘QR SQR-00480 ↔ 디자인QR DQR-00479 상품코드 불일치" : "硅胶QR SQR-00480 ↔ 设计QR DQR-00479 商品代码不匹配", time: "14:32", severity: "high", status: "unprocessed" },
    { id: "EX-0230", type: t("defects.duplicateQR"), process: t("process.card"), detail: lang === "ko" ? "카드바코드 CRD-0480 이미 사용됨 (14:20 포장 완료)" : "卡片条码 CRD-0480 已使用（14:20包装完成）", time: "14:15", severity: "high", status: "rework" },
    { id: "EX-0229", type: t("defects.commError"), process: lang === "ko" ? "택배봉투기 B" : "快递包装机 B", detail: lang === "ko" ? "MCH-005 통신 끊김 17분 경과" : "MCH-005 通信中断已17分钟", time: "13:58", severity: "medium", status: "unprocessed" },
    { id: "EX-0228", type: t("defects.printFail"), process: t("process.shipping"), detail: lang === "ko" ? "ORD-24830 프린터 용지 부족" : "ORD-24830 打印机缺纸", time: "13:42", severity: "low", status: "completed" },
  ];

  const severityMap: Record<string, string> = { high: "status-stopped", medium: "status-warning", low: "status-idle" };
  const statusLabel: Record<string, string> = { unprocessed: t("status.unprocessed"), rework: t("status.rework"), completed: t("status.completed") };
  const statusBadge: Record<string, string> = { unprocessed: "status-stopped", rework: "status-warning", completed: "status-running" };

  return (
    <div>
      <PageHeader title={t("defects.title")} description={t("defects.desc")}>
        <Button size="sm" className="gap-1.5"><AlertTriangle className="w-4 h-4" /> {t("defects.register")}</Button>
      </PageHeader>
      <div className="p-6">
        <div className="space-y-3">
          {defects.map((d, i) => (
            <div key={d.id} className="kpi-card section-enter flex items-start gap-4" style={{ animationDelay: `${i * 80}ms` }}>
              <div className={`p-2 rounded-lg shrink-0 ${severityMap[d.severity]}`}><XCircle className="w-5 h-5" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{d.id}</span>
                  <span className={`status-badge ${severityMap[d.severity]}`}>{d.type}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{d.time}</span>
                </div>
                <p className="text-sm text-muted-foreground">{d.process} — {d.detail}</p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Camera className="w-3 h-3" /> {t("defects.photo")}</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><RotateCcw className="w-3 h-3" /> {t("defects.rework")}</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive"><Trash2 className="w-3 h-3" /> {t("defects.dispose")}</Button>
                </div>
              </div>
              <span className={`status-badge shrink-0 ${statusBadge[d.status]}`}>{statusLabel[d.status]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
