import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Printer, Truck, Search } from "lucide-react";

const shipments = [
  { order: "ORD-24831", setId: "SET-20240315-0312", recipient: "홍길동", phone: "010-****-5678", address: "서울시 강남구 역삼동 123-4", product: "BT-2024-A", invoice: "CJ-123456789", status: "출고완료" },
  { order: "ORD-24832", setId: "SET-20240315-0311", recipient: "김철수", phone: "010-****-1234", address: "경기도 성남시 분당구 판교로 45", product: "BT-2024-A", invoice: "-", status: "송장대기" },
  { order: "ORD-24833", setId: "SET-20240315-0310", recipient: "이영희", phone: "010-****-9012", address: "부산시 해운대구 우동 567", product: "BT-2024-B", invoice: "-", status: "출고보류" },
];

const statusMap: Record<string, string> = {
  "송장대기": "status-idle",
  "송장출력완료": "status-warning",
  "출고완료": "status-running",
  "출고보류": "status-stopped",
};

export default function Shipping() {
  return (
    <div>
      <PageHeader title="택배 출고 관리" description="세트 완료 상품의 송장 매칭 및 출고 처리">
        <Button size="sm" variant="outline" className="gap-1.5">
          <Printer className="w-4 h-4" /> 일괄 송장 출력
        </Button>
      </PageHeader>
      <div className="p-6">
        <div className="kpi-card section-enter">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder="주문번호, 수취인명 검색..." />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {["주문번호", "Set ID", "수취인", "연락처", "주소", "상품", "송장번호", "상태", ""].map(h => (
                    <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => (
                  <tr key={s.order} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 font-medium text-primary pr-4">{s.order}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{s.setId}</td>
                    <td className="py-2.5 pr-4">{s.recipient}</td>
                    <td className="py-2.5 text-muted-foreground pr-4">{s.phone}</td>
                    <td className="py-2.5 pr-4 max-w-[200px] truncate">{s.address}</td>
                    <td className="py-2.5 pr-4">{s.product}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{s.invoice}</td>
                    <td className="py-2.5 pr-4"><span className={`status-badge ${statusMap[s.status]}`}>{s.status}</span></td>
                    <td className="py-2.5">
                      {s.status === "송장대기" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                          <Printer className="w-3 h-3" /> 출력
                        </Button>
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
