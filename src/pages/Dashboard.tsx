import {
  Shirt, CreditCard, Package, Truck, AlertTriangle,
  ClipboardList, Monitor, CheckCircle2, XCircle, Clock
} from "lucide-react";
import KpiCard from "@/components/KpiCard";
import PageHeader from "@/components/PageHeader";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const hourlyData = [
  { hour: "08시", 티셔츠: 45, 카드: 62, 세트: 38 },
  { hour: "09시", 티셔츠: 78, 카드: 85, 세트: 65 },
  { hour: "10시", 티셔츠: 92, 카드: 98, 세트: 80 },
  { hour: "11시", 티셔츠: 85, 카드: 90, 세트: 72 },
  { hour: "12시", 티셔츠: 30, 카드: 35, 세트: 25 },
  { hour: "13시", 티셔츠: 88, 카드: 95, 세트: 78 },
  { hour: "14시", 티셔츠: 95, 카드: 102, 세트: 85 },
  { hour: "15시", 티셔츠: 72, 카드: 78, 세트: 60 },
];

const machineData = [
  { name: "카드 포장기 A", status: "가동중", speed: "120개/분", uptime: "97.2%", count: 3842 },
  { name: "세트 포장기 B", status: "가동중", speed: "85개/분", uptime: "94.8%", count: 2156 },
  { name: "택배봉투기 C", status: "일시정지", speed: "-", uptime: "88.5%", count: 1830 },
];

const recentExceptions = [
  { id: "EX-0231", type: "QR 불일치", process: "티셔츠 제작", time: "14:32", severity: "high" },
  { id: "EX-0230", type: "중복 QR 사용", process: "카드 포장", time: "14:15", severity: "high" },
  { id: "EX-0229", type: "기계 통신 끊김", process: "택배봉투기", time: "13:58", severity: "medium" },
  { id: "EX-0228", type: "송장 출력 실패", process: "택배 출고", time: "13:42", severity: "low" },
];

const processProgress = [
  { name: "티셔츠 제작", value: 78, color: "hsl(205, 75%, 42%)" },
  { name: "카드 포장", value: 85, color: "hsl(152, 60%, 42%)" },
  { name: "세트 포장", value: 62, color: "hsl(38, 92%, 50%)" },
  { name: "택배 출고", value: 45, color: "hsl(280, 55%, 52%)" },
];

const pendingShipments = [
  { order: "ORD-24831", product: "BT-2024-A", design: "DSN-047", status: "송장대기" },
  { order: "ORD-24832", product: "BT-2024-B", design: "DSN-012", status: "송장대기" },
  { order: "ORD-24833", product: "BT-2024-C", design: "DSN-089", status: "출고보류" },
];

export default function Dashboard() {
  return (
    <div>
      <PageHeader title="대시보드" description="전체 생산·포장·출고 현황을 한눈에 확인합니다" />

      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard icon={ClipboardList} label="오늘 작업지시" value="1,240" change="전일 대비 +8.3%" changeType="positive" delay={0} />
          <KpiCard icon={Shirt} label="제작 완료" value="876" change="목표 대비 70.6%" changeType="neutral" delay={60} />
          <KpiCard icon={Package} label="세트 완료" value="654" change="목표 대비 52.7%" changeType="neutral" delay={120} />
          <KpiCard icon={Truck} label="출고 완료" value="512" change="목표 대비 41.3%" changeType="neutral" delay={180} />
          <KpiCard icon={AlertTriangle} label="오류 건수" value="7" change="전일 대비 -3건" changeType="positive" delay={240} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Hourly production chart */}
          <div className="lg:col-span-2 kpi-card section-enter" style={{ animationDelay: "300ms" }}>
            <h3 className="text-sm font-medium mb-4">시간대별 생산량</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hourlyData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 88%)" />
                <XAxis dataKey="hour" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid hsl(214, 20%, 88%)",
                    fontSize: 12,
                    boxShadow: "0 4px 12px hsl(215, 25%, 15%, 0.08)",
                  }}
                />
                <Bar dataKey="티셔츠" fill="hsl(205, 75%, 42%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="카드" fill="hsl(152, 60%, 42%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="세트" fill="hsl(38, 92%, 50%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Process progress */}
          <div className="kpi-card section-enter" style={{ animationDelay: "360ms" }}>
            <h3 className="text-sm font-medium mb-4">공정별 진행률</h3>
            <div className="space-y-4">
              {processProgress.map((p) => (
                <div key={p.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{p.name}</span>
                    <span className="font-medium tabular-nums">{p.value}%</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: "hsl(var(--muted))" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${p.value}%`, background: p.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Machine status */}
          <div className="kpi-card section-enter" style={{ animationDelay: "420ms" }}>
            <h3 className="text-sm font-medium mb-4">기계 상태</h3>
            <div className="space-y-3">
              {machineData.map((m) => (
                <div key={m.name} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "hsl(var(--surface-sunken))" }}>
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">가동률 {m.uptime} · {m.count.toLocaleString()}개</p>
                  </div>
                  <span className={`status-badge ${
                    m.status === "가동중" ? "status-running" :
                    m.status === "일시정지" ? "status-warning" : "status-stopped"
                  }`}>
                    {m.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent exceptions */}
          <div className="kpi-card section-enter" style={{ animationDelay: "480ms" }}>
            <h3 className="text-sm font-medium mb-4">예외 발생 목록</h3>
            <div className="space-y-2">
              {recentExceptions.map((e) => (
                <div key={e.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                  {e.severity === "high" ? (
                    <XCircle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
                  ) : e.severity === "medium" ? (
                    <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.type}</p>
                    <p className="text-xs text-muted-foreground">{e.process} · {e.time}</p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{e.id}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pending shipments */}
          <div className="kpi-card section-enter" style={{ animationDelay: "540ms" }}>
            <h3 className="text-sm font-medium mb-4">미처리 송장 목록</h3>
            <div className="space-y-2">
              {pendingShipments.map((s) => (
                <div key={s.order} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "hsl(var(--surface-sunken))" }}>
                  <div>
                    <p className="text-sm font-medium">{s.order}</p>
                    <p className="text-xs text-muted-foreground">{s.product} · {s.design}</p>
                  </div>
                  <span className={`status-badge ${s.status === "출고보류" ? "status-warning" : "status-idle"}`}>
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
