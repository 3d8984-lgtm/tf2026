import { useState, useMemo } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Upload, Database,
  Shirt, Activity, AlertTriangle, FileBarChart, Settings,
  ChevronLeft, ChevronRight, ScanLine, Globe, LogOut, Truck, Search
} from "lucide-react";
import { useLang, type Lang } from "@/contexts/LangContext";
import { useAuth } from "@/hooks/useAuth";
import twinmetaLogo from "@/assets/twinmeta-logo.png";

interface MenuItem {
  path: string;
  icon: typeof LayoutDashboard;
  key: string;
  children?: { label: { ko: string; zh: string }; tab: string }[];
}

const menuKeys: MenuItem[] = [
  { path: "/", icon: LayoutDashboard, key: "menu.dashboard" },
  { path: "/upload", icon: Upload, key: "menu.upload", children: [
    { label: { ko: "API 연동", zh: "API连接" }, tab: "api" },
    { label: { ko: "파일 업로드", zh: "文件上传" }, tab: "file" },
  ]},
  { path: "/master", icon: Database, key: "menu.master" },
  { path: "/tshirt-work", icon: ScanLine, key: "menu.tshirtWork" },
  { path: "/tshirt", icon: Shirt, key: "menu.tshirt" },
  { path: "/monitor", icon: Activity, key: "menu.monitor", children: [
    { label: { ko: "주문 관리", zh: "订单管理" }, tab: "orders" },
    { label: { ko: "주문 파이프라인", zh: "订单流水线" }, tab: "pipeline" },
    { label: { ko: "카드 포장", zh: "卡片包装" }, tab: "card" },
    { label: { ko: "세트 포장", zh: "套装包装" }, tab: "set" },
    { label: { ko: "배송 관리", zh: "配送管理" }, tab: "shipping" },
    { label: { ko: "기계 상태", zh: "设备状态" }, tab: "machines" },
  ]},
  { path: "/shipping", icon: Truck, key: "menu.shipping" },
  { path: "/defects", icon: AlertTriangle, key: "menu.defects" },
  { path: "/reports", icon: FileBarChart, key: "menu.reports", children: [
    { label: { ko: "생산 실적", zh: "生产实绩" }, tab: "production" },
    { label: { ko: "불량 분석", zh: "不良分析" }, tab: "defect" },
    { label: { ko: "배송 현황", zh: "配送现况" }, tab: "shipping" },
  ]},
  { path: "/settings", icon: Settings, key: "menu.settings", children: [
    { label: { ko: "일반", zh: "常规" }, tab: "general" },
    { label: { ko: "사용자 관리", zh: "用户管理" }, tab: "users" },
    { label: { ko: "장비 관리", zh: "设备管理" }, tab: "equipment" },
    { label: { ko: "PLC 태그", zh: "PLC标签" }, tab: "plcTags" },
    { label: { ko: "센서", zh: "传感器" }, tab: "sensors" },
    { label: { ko: "명령어", zh: "指令" }, tab: "commands" },
    { label: { ko: "알람", zh: "报警" }, tab: "alarms" },
    { label: { ko: "검사 기준", zh: "检查标准" }, tab: "inspection" },
    { label: { ko: "Webhook", zh: "Webhook" }, tab: "webhook" },
    { label: { ko: "택배사 연동", zh: "快递对接" }, tab: "courier" },
    { label: { ko: "A사이트 회신", zh: "A站点回调" }, tab: "callback" },
  ]},
];

interface SearchResult {
  path: string;
  icon: typeof LayoutDashboard;
  label: string;
  parentLabel?: string;
  tab?: string;
}

const langOptions: { value: Lang; label: string; flag: string }[] = [
  { value: "ko", label: "한국어", flag: "🇰🇷" },
  { value: "zh", label: "中文", flag: "🇨🇳" },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { lang, setLang, t } = useLang();
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  const searchResults = useMemo((): SearchResult[] => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return [];
    const results: SearchResult[] = [];
    for (const item of menuKeys) {
      const parentLabel = t(item.key);
      const parentMatch = parentLabel.toLowerCase().includes(q);
      if (parentMatch) {
        results.push({ path: item.path, icon: item.icon, label: parentLabel });
      }
      if (item.children) {
        for (const child of item.children) {
          const childLabel = child.label[lang];
          if (childLabel.toLowerCase().includes(q) || parentMatch) {
            if (!parentMatch || childLabel.toLowerCase().includes(q)) {
              results.push({ path: item.path, icon: item.icon, label: childLabel, parentLabel, tab: child.tab });
            }
          }
        }
      }
    }
    return results;
  }, [menuSearch, lang]);

  const handleSearchNavigate = (result: SearchResult) => {
    if (result.tab) {
      navigate(`${result.path}?tab=${result.tab}`);
    } else {
      navigate(result.path);
    }
    setMenuSearch("");
    setSearchOpen(false);
  };

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
          {filteredMenu.map(({ path, icon: Icon, key }) => (
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
              onClick={() => { setMenuSearch(""); setSearchOpen(false); }}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {!collapsed && <span className="truncate">{t(key)}</span>}
            </NavLink>
          ))}
          {filteredMenu.length === 0 && (
            <p className="text-xs text-center py-4 opacity-50" style={{ color: "hsl(var(--sidebar-foreground))" }}>
              {lang === "ko" ? "결과 없음" : "无结果"}
            </p>
          )}
        </nav>

        {/* Menu search */}
        <div className="px-2 py-2 border-t" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          {collapsed ? (
            <button
              onClick={() => { setCollapsed(false); setSearchOpen(true); }}
              className="flex items-center justify-center w-full py-2 rounded-md transition-colors hover:opacity-90"
              style={{ color: "hsl(var(--sidebar-foreground))" }}
              title={lang === "ko" ? "메뉴 검색" : "搜索菜单"}
            >
              <Search className="w-4 h-4" />
            </button>
          ) : searchOpen ? (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" style={{ color: "hsl(var(--sidebar-foreground))" }} />
              <input
                autoFocus
                value={menuSearch}
                onChange={e => setMenuSearch(e.target.value)}
                onBlur={() => { if (!menuSearch) setSearchOpen(false); }}
                onKeyDown={e => {
                  if (e.key === "Escape") { setMenuSearch(""); setSearchOpen(false); }
                  if (e.key === "Enter" && filteredMenu.length === 1) {
                    navigate(filteredMenu[0].path);
                    setMenuSearch(""); setSearchOpen(false);
                  }
                }}
                placeholder={lang === "ko" ? "메뉴 검색..." : "搜索菜单..."}
                className="w-full pl-8 pr-3 py-1.5 rounded-md text-xs border bg-transparent outline-none"
                style={{
                  color: "hsl(var(--sidebar-foreground))",
                  borderColor: "hsl(var(--sidebar-border))",
                }}
              />
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs transition-colors hover:opacity-90"
              style={{ color: "hsl(var(--sidebar-foreground))" }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span>{lang === "ko" ? "메뉴 검색" : "搜索菜单"}</span>
            </button>
          )}
        </div>

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
