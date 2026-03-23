import PageHeader from "@/components/PageHeader";
import { Search, FileBarChart } from "lucide-react";

export default function Reports() {
  const reports = [
    "일별 생산 실적", "일별 카드 포장 실적", "일별 세트 포장 실적",
    "일별 출고 실적", "기계별 가동률", "불량률 분석",
    "작업자별 처리량", "디자인별 생산 수량",
  ];

  return (
    <div>
      <PageHeader title="이력조회 / 리포트" description="생산 실적, 추적 조회, 통계 리포트" />
      <div className="p-6 space-y-6">
        {/* Tracing search */}
        <div className="kpi-card section-enter">
          <h3 className="text-sm font-medium mb-3">추적 조회</h3>
          <p className="text-xs text-muted-foreground mb-3">QR값, 바코드, Set ID, 송장번호, 주문번호로 전 공정 이력을 추적합니다</p>
          <div className="relative max-w-lg">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder="추적 값 입력 (QR, 바코드, Set ID, 송장번호...)" />
          </div>
        </div>

        {/* Report list */}
        <div className="kpi-card section-enter" style={{ animationDelay: "120ms" }}>
          <h3 className="text-sm font-medium mb-4">기본 리포트</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {reports.map((r) => (
              <button key={r} className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary/40 text-sm text-left transition-all active:scale-[0.97]">
                <FileBarChart className="w-4 h-4 text-primary shrink-0" />
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
