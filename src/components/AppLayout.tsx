import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard, Upload, Database, ClipboardList, Shirt, CreditCard,
  Package, Truck, Monitor, AlertTriangle, FileBarChart, Settings,
  ChevronLeft, ChevronRight, Box
} from "lucide-react";

const menuItems = [
  { path: "/", icon: LayoutDashboard, label: "대시보드" },
  { path: "/upload", icon: Upload, label: "파일 업로드" },
  { path: "/master", icon: Database, label: "기준정보 관리" },
  { path: "/work-orders", icon: ClipboardList, label: "작업지시 관리" },
  { path: "/tshirt", icon: Shirt, label: "티셔츠 제작 관리" },
  { path: "/card-packing", icon: CreditCard, label: "카드 포장 관리" },
  { path: "/set-packing", icon: Package, label: "세트 포장 관리" },
  { path: "/shipping", icon: Truck, label: "택배 출고 관리" },
  { path: "/machines", icon: Monitor, label: "기계 모니터링" },
  { path: "/defects", icon: AlertTriangle, label: "불량/예외 관리" },
  { path: "/reports", icon: FileBarChart, label: "이력조회/리포트" },
  { path: "/settings", icon: Settings, label: "시스템 설정" },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

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
          <Box className="w-6 h-6 shrink-0" style={{ color: "hsl(var(--sidebar-primary))" }} />
          {!collapsed && (
            <span className="text-sm font-semibold truncate" style={{ color: "hsl(var(--sidebar-accent-foreground))" }}>
              Smart Set Packing
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {menuItems.map(({ path, icon: Icon, label }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                  isActive
                    ? "font-medium"
                    : "hover:opacity-90"
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? "hsl(var(--sidebar-accent))" : "transparent",
                color: isActive ? "hsl(var(--sidebar-accent-foreground))" : "hsl(var(--sidebar-foreground))",
              })}
              title={label}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

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
