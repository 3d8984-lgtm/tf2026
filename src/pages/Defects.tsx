import PageHeader from "@/components/PageHeader";
import { AlertTriangle, XCircle, Camera, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const defects = [
  { id: "EX-0231", type: "QR 불일치", process: "티셔츠 제작", detail: "실리콘QR SQR-00480 ↔ 디자인QR DQR-00479 상품코드 불일치", time: "14:32", severity: "high", status: "미처리" },
  { id: "EX-0230", type: "중복 QR 사용", process: "카드 포장", detail: "카드바코드 CRD-0480 이미 사용됨 (14:20 포장 완료)", time: "14:15", severity: "high", status: "재작업" },
  { id: "EX-0229", type: "기계 통신 오류", process: "택배봉투기 B", detail: "MCH-005 통신 끊김 17분 경과", time: "13:58", severity: "medium", status: "미처리" },
  { id: "EX-0228", type: "송장 출력 실패", process: "택배 출고", detail: "ORD-24830 프린터 용지 부족", time: "13:42", severity: "low", status: "처리완료" },
];

const severityMap: Record<string, string> = { high: "status-stopped", medium: "status-warning", low: "status-idle" };

export default function Defects() {
  return (
    <div>
      <PageHeader title="불량/예외 관리" description="예외 상황 등록, 원인 분류, 재작업 관리">
        <Button size="sm" className="gap-1.5">
          <AlertTriangle className="w-4 h-4" /> 예외 등록
        </Button>
      </PageHeader>
      <div className="p-6">
        <div className="space-y-3">
          {defects.map((d, i) => (
            <div key={d.id} className="kpi-card section-enter flex items-start gap-4" style={{ animationDelay: `${i * 80}ms` }}>
              <div className={`p-2 rounded-lg shrink-0 ${severityMap[d.severity]}`}>
                <XCircle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{d.id}</span>
                  <span className={`status-badge ${severityMap[d.severity]}`}>{d.type}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{d.time}</span>
                </div>
                <p className="text-sm text-muted-foreground">{d.process} — {d.detail}</p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Camera className="w-3 h-3" /> 사진</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><RotateCcw className="w-3 h-3" /> 재작업</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive"><Trash2 className="w-3 h-3" /> 폐기</Button>
                </div>
              </div>
              <span className={`status-badge shrink-0 ${
                d.status === "미처리" ? "status-stopped" : d.status === "재작업" ? "status-warning" : "status-running"
              }`}>{d.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
