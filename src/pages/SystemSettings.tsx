import PageHeader from "@/components/PageHeader";
import { Users, Bell, Shield, Cog } from "lucide-react";

const settingGroups = [
  { icon: Users, label: "사용자 관리", desc: "사용자 계정 및 권한 설정" },
  { icon: Shield, label: "권한 설정", desc: "역할별 메뉴 접근 권한 관리" },
  { icon: Bell, label: "알림 설정", desc: "알림 조건 및 수신 방법 설정" },
  { icon: Cog, label: "시스템 설정", desc: "기본 설정 및 연동 관리" },
];

export default function SystemSettings() {
  return (
    <div>
      <PageHeader title="시스템 설정" description="사용자, 권한, 알림, 시스템 설정 관리" />
      <div className="p-6">
        <div className="grid md:grid-cols-2 gap-4">
          {settingGroups.map((g, i) => (
            <div key={g.label} className="kpi-card section-enter cursor-pointer hover:border-primary/30 flex items-center gap-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="p-3 rounded-lg" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                <g.icon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-medium">{g.label}</p>
                <p className="text-sm text-muted-foreground">{g.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
