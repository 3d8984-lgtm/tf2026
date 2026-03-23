import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";

const workOrders = [
  { id: "WO-20240315-001", product: "BT-2024-A", design: "DSN-047", qty: 500, date: "2024-03-15", line: "라인 A", assignee: "김작업", status: "진행중" },
  { id: "WO-20240315-002", product: "BT-2024-B", design: "DSN-012", qty: 300, date: "2024-03-15", line: "라인 B", assignee: "이작업", status: "대기" },
  { id: "WO-20240314-005", product: "BT-2024-C", design: "DSN-089", qty: 800, date: "2024-03-14", line: "라인 A", assignee: "김작업", status: "완료" },
  { id: "WO-20240314-004", product: "BT-2024-A", design: "DSN-047", qty: 450, date: "2024-03-14", line: "라인 C", assignee: "박작업", status: "완료" },
];

const statusColor: Record<string, string> = {
  "진행중": "status-running",
  "대기": "status-idle",
  "완료": "status-running",
  "중지": "status-stopped",
};

export default function WorkOrders() {
  return (
    <div>
      <PageHeader title="작업지시 관리" description="생산 작업지시를 등록하고 관리합니다">
        <Button size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" /> 작업지시 등록
        </Button>
      </PageHeader>
      <div className="p-6">
        <div className="kpi-card section-enter">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder="작업지시번호, 상품코드 검색..." />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {["작업지시번호", "상품코드", "디자인코드", "수량", "작업일", "라인", "담당자", "상태"].map((h) => (
                    <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workOrders.map((wo) => (
                  <tr key={wo.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                    <td className="py-2.5 font-medium text-primary pr-4">{wo.id}</td>
                    <td className="py-2.5 pr-4">{wo.product}</td>
                    <td className="py-2.5 pr-4">{wo.design}</td>
                    <td className="py-2.5 tabular-nums pr-4">{wo.qty.toLocaleString()}</td>
                    <td className="py-2.5 text-muted-foreground pr-4">{wo.date}</td>
                    <td className="py-2.5 pr-4">{wo.line}</td>
                    <td className="py-2.5 pr-4">{wo.assignee}</td>
                    <td className="py-2.5">
                      <span className={`status-badge ${statusColor[wo.status] || "status-idle"}`}>{wo.status}</span>
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
