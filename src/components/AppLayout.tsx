import { useState, useMemo } from "react";
import AiChatbot from "@/components/AiChatbot";
import { NavLink, Link, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Upload, Database,
  Shirt, Activity, AlertTriangle, FileBarChart, Settings,
  ChevronLeft, ChevronRight, ScanLine, Globe, LogOut, Truck, Search, BookOpen, QrCode, Camera,
  Factory, ClipboardList, Stamp, Printer, Sparkles, CreditCard, Image as ImageIcon,
} from "lucide-react";
import { useLang, type Lang } from "@/contexts/LangContext";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import twinmetaLogo from "@/assets/twinmeta-logo.png";

interface MenuItem {
  path: string;
  icon: typeof LayoutDashboard;
  key: string;
  section?: "hq" | "outsource";
  children?: { label: { ko: string; zh: string }; tab: string }[];
}

const menuKeys: MenuItem[] = [
  { path: "/", icon: LayoutDashboard, key: "menu.dashboard", section: "hq" },
  { path: "/upload", icon: Upload, key: "menu.upload", section: "hq", children: [
    { label: { ko: "API 연동", zh: "API连接" }, tab: "api" },
    { label: { ko: "파일 업로드", zh: "文件上传" }, tab: "file" },
  ]},
  { path: "/card-qr-inspect", icon: QrCode, key: "menu.cardQrInspect", section: "hq" },
  { path: "/card-photo-inspect", icon: Camera, key: "menu.cardPhotoInspect", section: "hq" },
  { path: "/tshirt-work", icon: ScanLine, key: "menu.tshirtWork", section: "hq" },
  { path: "/monitor", icon: Activity, key: "menu.monitor", section: "hq", children: [
    { label: { ko: "주문 관리", zh: "订单管理" }, tab: "orders" },
    { label: { ko: "주문 파이프라인", zh: "订单流水线" }, tab: "pipeline" },
    { label: { ko: "카드 포장", zh: "卡片包装" }, tab: "card" },
    { label: { ko: "세트 포장", zh: "套装包装" }, tab: "set" },
    { label: { ko: "배송 관리", zh: "配送管理" }, tab: "shipping" },
    { label: { ko: "기계 상태", zh: "设备状态" }, tab: "machines" },
  ]},
  { path: "/shipping", icon: Truck, key: "menu.shipping", section: "hq" },
  { path: "/defects", icon: AlertTriangle, key: "menu.defects", section: "hq" },
  { path: "/reports", icon: FileBarChart, key: "menu.reports", section: "hq", children: [
    { label: { ko: "생산 실적", zh: "生产实绩" }, tab: "production" },
    { label: { ko: "불량 분석", zh: "不良分析" }, tab: "defect" },
    { label: { ko: "배송 현황", zh: "配送现况" }, tab: "shipping" },
  ]},
  { path: "/manual", icon: BookOpen, key: "menu.manual", section: "hq" },
  { path: "/master", icon: Database, key: "menu.master", section: "hq" },
  { path: "/settings", icon: Settings, key: "menu.settings", section: "hq", children: [
    { label: { ko: "일반", zh: "常规" }, tab: "general" },
    { label: { ko: "사용자 관리", zh: "用户管理" }, tab: "users" },
    { label: { ko: "장비 관리", zh: "设备管理" }, tab: "equipment" },
    { label: { ko: "PLC 태그", zh: "PLC标签" }, tab: "plcTags" },
    { label: { ko: "센서", zh: "传感器" }, tab: "sensors" },
    { label: { ko: "명령어", zh: "指令" }, tab: "commands" },
    { label: { ko: "알람", zh: "报警" }, tab: "alarms" },
    { label: { ko: "검수 기준", zh: "检验标准" }, tab: "inspection" },
    { label: { ko: "Webhook", zh: "Webhook" }, tab: "webhook" },
    { label: { ko: "택배사 연동", zh: "快递对接" }, tab: "courier" },
    { label: { ko: "TWINMETA 회신", zh: "TWINMETA回调" }, tab: "callback" },
  ]},
  // Outsource production
  { path: "/outsource", icon: Factory, key: "menu.outDashboard", section: "outsource" },
  { path: "/outsource/orders", icon: ClipboardList, key: "menu.outOrders", section: "outsource" },
  { path: "/outsource/silicon", icon: Stamp, key: "menu.outSilicon", section: "outsource" },
  { path: "/outsource/heat-transfer", icon: Printer, key: "menu.outHeatTransfer", section: "outsource" },
  { path: "/outsource/hologram", icon: Sparkles, key: "menu.outHologram", section: "outsource" },
  { path: "/outsource/nfc-card", icon: CreditCard, key: "menu.outNfcCard", section: "outsource" },
  { path: "/outsource/logo", icon: ImageIcon, key: "menu.outLogo", section: "outsource" },
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
  const { canAccessMenu } = usePermissions();
  const navigate = useNavigate();

  // Filter menu items based on role permissions
  const visibleMenuKeys = menuKeys.filter(item => canAccessMenu(item.path));

  // Korean chosung (초성) search support
  const CHOSUNG = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  const getChosung = (str: string) => str.split("").map(ch => {
    const code = ch.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return ch;
    return CHOSUNG[Math.floor(code / 588)];
  }).join("");
  const isAllChosung = (str: string) => str.split("").every(ch => CHOSUNG.includes(ch));

  const matchSearch = (label: string, query: string) => {
    const lower = label.toLowerCase();
    const q = query.toLowerCase();
    if (lower.includes(q)) return true;
    // chosung matching: if query is all chosung chars, match against chosung of label
    if (isAllChosung(q) && getChosung(label).includes(q)) return true;
    return false;
  };

  const searchResults = useMemo((): SearchResult[] => {
    const q = menuSearch.trim();
    if (!q) return [];
    const results: SearchResult[] = [];
    for (const item of visibleMenuKeys) {
      const parentLabel = t(item.key);
      const parentMatch = matchSearch(parentLabel, q);
      if (parentMatch) {
        results.push({ path: item.path, icon: item.icon, label: parentLabel });
      }
      if (item.children) {
        for (const child of item.children) {
          const childLabel = child.label[lang];
          if (matchSearch(childLabel, q) || parentMatch) {
            if (!parentMatch || matchSearch(childLabel, q)) {
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
        <Link to="/" className="flex items-center gap-2 px-4 h-14 border-b hover:opacity-80 transition-opacity" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <img src={twinmetaLogo} alt="TWINMETA" className="h-6 shrink-0" style={{ aspectRatio: '1/1', objectFit: 'contain' }} />
          {!collapsed && (
            <span className="text-sm font-semibold truncate" style={{ color: "hsl(var(--sidebar-accent-foreground))" }}>
              {t("app.name")}
            </span>
          )}
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {menuSearch.trim() ? (
            <>
              {searchResults.map((r, i) => (
                <button
                  key={`${r.path}-${r.tab ?? i}`}
                  onClick={() => handleSearchNavigate(r)}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors duration-150 hover:opacity-90 w-full text-left"
                  style={{ color: "hsl(var(--sidebar-foreground))" }}
                >
                  <r.icon className="w-[18px] h-[18px] shrink-0" />
                  <div className="min-w-0 truncate">
                    {r.parentLabel && (
                      <span className="opacity-50 text-xs">{r.parentLabel} &rsaquo; </span>
                    )}
                    <span>{r.label}</span>
                  </div>
                </button>
              ))}
              {searchResults.length === 0 && (
                <p className="text-xs text-center py-4 opacity-50" style={{ color: "hsl(var(--sidebar-foreground))" }}>
                  {lang === "ko" ? "결과 없음" : "无结果"}
                </p>
              )}
            </>
          ) : (
            visibleMenuKeys.map(({ path, icon: Icon, key }) => (
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
            ))
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
                  if (e.key === "Enter" && searchResults.length === 1) {
                    handleSearchNavigate(searchResults[0]);
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

      {/* AI Chatbot */}
      <AiChatbot />
    </div>
  );
}
