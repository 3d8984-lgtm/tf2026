import PageHeader from "@/components/PageHeader";
import { Users, Bell, Shield, Cog } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

export default function SystemSettings() {
  const { t } = useLang();

  const settingGroups = [
    { icon: Users, label: t("settings.userMgmt"), desc: t("settings.userMgmtDesc") },
    { icon: Shield, label: t("settings.permissions"), desc: t("settings.permissionsDesc") },
    { icon: Bell, label: t("settings.notifications"), desc: t("settings.notificationsDesc") },
    { icon: Cog, label: t("settings.system"), desc: t("settings.systemDesc") },
  ];

  return (
    <div>
      <PageHeader title={t("settings.title")} description={t("settings.desc")} />
      <div className="p-6">
        <div className="grid md:grid-cols-2 gap-4">
          {settingGroups.map((g, i) => (
            <div key={g.label} className="kpi-card section-enter cursor-pointer hover:border-primary/30 flex items-center gap-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="p-3 rounded-lg" style={{ background: "hsl(var(--primary) / 0.08)" }}><g.icon className="w-6 h-6 text-primary" /></div>
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
