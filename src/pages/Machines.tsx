import PageHeader from "@/components/PageHeader";
import { Wifi, WifiOff, Gauge, AlertTriangle } from "lucide-react";
import OrderPipeline from "@/components/OrderPipeline";

const machines = [
  { id: "A-1", name: "티셔츠 제작기 A-1", status: "가동중", speed: "95개/분", uptime: "97.2%", total: 38420, error: "-", lastComm: "14:37:05" },
  { id: "A-2", name: "티셔츠 제작기 A-2", status: "일시정지", speed: "-", uptime: "91.5%", total: 28150, error: "-", lastComm: "14:35:22" },
  { id: "A-3", name: "티셔츠 제작기 A-3", status: "가동중", speed: "92개/분", uptime: "94.8%", total: 21560, error: "-", lastComm: "14:37:03" },
  { id: "B-1", name: "카드 포장기 B-1", status: "가동중", speed: "120개/분", uptime: "96.1%", total: 42150, error: "-", lastComm: "14:37:01" },
  { id: "B-2", name: "세트 포장기 B-2", status: "가동중", speed: "85개/분", uptime: "93.4%", total: 31200, error: "-", lastComm: "14:36:58" },
  { id: "B-3", name: "택배 포장기 B-3", status: "가동중", speed: "78개/분", uptime: "88.5%", total: 18300, error: "-", lastComm: "14:36:55" },
  { id: "B-4", name: "송장 부착기 B-4", status: "가동중", speed: "110개/분", uptime: "95.7%", total: 35680, error: "-", lastComm: "14:37:04" },
];

const statusMap: Record<string, { badge: string; icon: typeof Wifi }> = {
  "가동중": { badge: "status-running", icon: Wifi },
  "정지": { badge: "status-stopped", icon: WifiOff },
  "일시정지": { badge: "status-warning", icon: Gauge },
  "오류발생": { badge: "status-stopped", icon: AlertTriangle },
  "통신끊김": { badge: "status-stopped", icon: WifiOff },
};

export default function Machines() {
  return (
    <div>
      <PageHeader title="기계 모니터링" description="포장기계 가동 상태 및 실시간 모니터링" />
      <div className="p-6 space-y-8">
        {/* Order Pipeline */}
        <div>
          <h2 className="text-sm font-semibold mb-4 text-foreground">주문별 공정 진행 현황</h2>
          <OrderPipeline />
        </div>

        {/* Machine Cards */}
        <div>
          <h2 className="text-sm font-semibold mb-4 text-foreground">기계 상태</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {machines.map((m, i) => {
              const st = statusMap[m.status] || statusMap["정지"];
              const StIcon = st.icon;
              return (
                <div key={m.id} className="kpi-card section-enter" style={{ animationDelay: `${(i + 6) * 80}ms` }}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.id}</p>
                    </div>
                    <span className={`status-badge ${st.badge}`}>
                      <StIcon className="w-3 h-3" /> {m.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">속도</p>
                      <p className="font-medium tabular-nums">{m.speed}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">가동률</p>
                      <p className="font-medium tabular-nums">{m.uptime}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">누적 작업량</p>
                      <p className="font-medium tabular-nums">{m.total.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">오류코드</p>
                      <p className={`font-medium ${m.error !== "-" ? "text-destructive" : ""}`}>{m.error}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                    최근 통신: {m.lastComm}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
