import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard, Upload, Database, ClipboardList, Shirt,
  Activity, AlertTriangle, FileBarChart, Settings,
  ChevronLeft, ChevronRight, ScanLine, Globe, LogOut, Truck
} from "lucide-react";
import { useLang, type Lang } from "@/contexts/LangContext";
import { useAuth } from "@/hooks/useAuth";
import twinmetaLogo from "@/assets/twinmeta-logo.png";

const menuKeys = [
  { path: "/", icon: LayoutDashboard, key: "menu.dashboard" },
  { path: "/upload", icon: Upload, key: "menu.upload" },
  { path: "/master", icon: Database, key: "menu.master" },
  { path: "/work-orders", icon: ClipboardList, key: "menu.workOrders" },
  { path: "/tshirt-work", icon: ScanLine, key: "menu.tshirtWork" },
  { path: "/tshirt", icon: Shirt, key: "menu.tshirt" },
  { path: "/monitor", icon: Activity, key: "menu.monitor" },
  { path: "/defects", icon: AlertTriangle, key: "menu.defects" },
  { path: "/reports", icon: FileBarChart, key: "menu.reports" },
  { path: "/settings", icon: Settings, key: "menu.settings" },
];

const langOptions: { value: Lang; label: string; flag: string }[] = [
  { value: "ko", label: "한국어", flag: "🇰🇷" },
  { value: "zh", label: "中文", flag: "🇨🇳" },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { lang, setLang, t } = useLang();
  const { signOut, user } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className="flex flex-col border-r transition-all duration-300 shrink-0"
        style={{
          width: collapsed ? 64 : 240,
          background: "hsl(var(--sidebar-background))",
          borderColor: "hsl(var(--sidebar-border))",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-14 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <img src={twinmetaLogo} alt="TWINMETA" className="h-6 shrink-0" style={{ aspectRatio: '1/1', objectFit: 'contain' }} />
          {!collapsed && (
            <span className="text-sm font-semibold truncate" style={{ color: "hsl(var(--sidebar-accent-foreground))" }}>
              {t("app.name")}
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {menuKeys.map(({ path, icon: Icon, key }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                  isActive ? "font-medium" : "hover:opacity-90"
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? "hsl(var(--sidebar-accent))" : "transparent",
                color: isActive ? "hsl(var(--sidebar-accent-foreground))" : "hsl(var(--sidebar-foreground))",
              })}
              title={t(key)}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {!collapsed && <span className="truncate">{t(key)}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Language switcher */}
        <div
          className="flex items-center gap-1 px-2 py-2 border-t"
          style={{ borderColor: "hsl(var(--sidebar-border))" }}
        >
          {!collapsed && <Globe className="w-4 h-4 shrink-0 ml-1" style={{ color: "hsl(var(--sidebar-foreground))" }} />}
          {langOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setLang(opt.value)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs transition-colors ${
                lang === opt.value
                  ? "font-semibold"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                background: lang === opt.value ? "hsl(var(--sidebar-accent))" : "transparent",
                color: "hsl(var(--sidebar-foreground))",
              }}
              title={opt.label}
            >
              <span>{opt.flag}</span>
              {!collapsed && <span>{opt.label}</span>}
            </button>
          ))}
        </div>

        {/* User & Logout */}
        <div className="px-2 py-2 border-t" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          {!collapsed && user && (
            <p className="text-xs truncate px-2 mb-1 opacity-60" style={{ color: "hsl(var(--sidebar-foreground))" }}>
              {user.email}
            </p>
          )}
          <button
            onClick={signOut}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors hover:opacity-90"
            style={{ color: "hsl(var(--sidebar-foreground))" }}
            title={t("auth.logout")}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>{t("auth.logout")}</span>}
          </button>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center h-10 border-t transition-colors"
          style={{
            borderColor: "hsl(var(--sidebar-border))",
            color: "hsl(var(--sidebar-foreground))",
          }}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
