import PageHeader from "@/components/PageHeader";
import { Database, Search } from "lucide-react";

const masters = [
  { category: "상품 마스터", count: 247, lastUpdate: "2024-03-15" },
  { category: "디자인 마스터", count: 89, lastUpdate: "2024-03-14" },
  { category: "로고 이미지", count: 89, lastUpdate: "2024-03-14" },
  { category: "카드 마스터", count: 312, lastUpdate: "2024-03-15" },
  { category: "QR/바코드 기준", count: 14820, lastUpdate: "2024-03-15" },
  { category: "출고처/택배사", count: 5, lastUpdate: "2024-02-28" },
];

export default function MasterData() {
  return (
    <div>
      <PageHeader title="기준정보 관리" description="상품, 디자인, 로고, QR/바코드 기준 데이터 관리" />
      <div className="p-6">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {masters.map((m, i) => (
            <div key={m.category} className="kpi-card section-enter cursor-pointer hover:border-primary/30" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{m.category}</p>
                  <p className="text-xs text-muted-foreground">{m.count.toLocaleString()}건 · 최종 {m.lastUpdate}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
