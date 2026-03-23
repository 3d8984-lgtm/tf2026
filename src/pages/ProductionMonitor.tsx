import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLang } from "@/contexts/LangContext";
import OrderPipeline from "@/components/OrderPipeline";
import {
  Wifi, WifiOff, Gauge, AlertTriangle, ScanLine, Package,
  CheckCircle2, XCircle, Printer, Search, Activity, ChevronDown, ChevronRight,
  PlayCircle, OctagonX
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/* ── Types ── */
interface CardLog { time: string; barcode: string; serial: string; printedQR: string; status: string }
interface SetLog { time: string; setId: string; tshirtQR: string; cardQR: string; match: boolean; status: string }
interface ShipItem { setId: string; recipientKo: string; recipientZh: string; phone: string; addressKo: string; addressZh: string; invoice: string; status: string }

interface OrderData {
  order: string; product: string; design: string; qty: number;
  cardLogs: CardLog[]; cardSummary: { scanDone: number; packing: number; ejected: number; error: number };
  setLogs: SetLog[]; setSummary: { matchWait: number; packDone: number; matchFail: number };
  shipItems: ShipItem[]; shipSummary: { invoiceWait: number; shipDone: number; shipHold: number };
}

/* ── Sample data grouped by order ── */
const ordersData: OrderData[] = [
  {
    order: "ORD-24831", product: "BT-2024-A", design: "DSN-047", qty: 200,
    cardSummary: { scanDone: 200, packing: 0, ejected: 185, error: 1 },
    cardLogs: [
      { time: "14:36:01", barcode: "CRD-0482", serial: "CS-A09312", printedQR: "CPQ-0482", status: "ejected" },
      { time: "14:35:42", barcode: "CRD-0481", serial: "CS-A09311", printedQR: "CPQ-0481", status: "ejected" },
      { time: "14:35:20", barcode: "CRD-0480", serial: "CS-A09310", printedQR: "-", status: "error" },
    ],
    setSummary: { matchWait: 43, packDone: 142, matchFail: 1 },
    setLogs: [
      { time: "14:37:01", setId: "SET-0312", tshirtQR: "DQR-0482", cardQR: "CPQ-0482", match: true, status: "packDone" },
      { time: "14:36:38", setId: "SET-0311", tshirtQR: "DQR-0481", cardQR: "CPQ-0481", match: true, status: "packDone" },
      { time: "14:36:12", setId: "-", tshirtQR: "DQR-0480", cardQR: "CPQ-0478", match: false, status: "matchFail" },
    ],
    shipSummary: { invoiceWait: 12, shipDone: 95, shipHold: 0 },
    shipItems: [
      { setId: "SET-0312", recipientKo: "홍길동", recipientZh: "洪吉童", phone: "010-****-5678", addressKo: "서울시 강남구 역삼동 123-4", addressZh: "首尔市江南区驿三洞123-4", invoice: "CJ-123456789", status: "shipDone" },
      { setId: "SET-0311", recipientKo: "김철수", recipientZh: "金哲秀", phone: "010-****-1234", addressKo: "경기도 성남시 분당구 판교로 45", addressZh: "京畿道城南市盆唐区板桥路45", invoice: "-", status: "invoiceWait" },
    ],
  },
  {
    order: "ORD-24832", product: "BT-2024-B", design: "DSN-012", qty: 150,
    cardSummary: { scanDone: 150, packing: 0, ejected: 150, error: 0 },
    cardLogs: [
      { time: "14:30:15", barcode: "CRD-0390", serial: "CS-B04210", printedQR: "CPQ-0390", status: "ejected" },
      { time: "14:29:58", barcode: "CRD-0389", serial: "CS-B04209", printedQR: "CPQ-0389", status: "ejected" },
    ],
    setSummary: { matchWait: 0, packDone: 150, matchFail: 0 },
    setLogs: [
      { time: "14:31:05", setId: "SET-0290", tshirtQR: "DQR-0390", cardQR: "CPQ-0390", match: true, status: "packDone" },
    ],
    shipSummary: { invoiceWait: 26, shipDone: 72, shipHold: 0 },
    shipItems: [
      { setId: "SET-0290", recipientKo: "박민수", recipientZh: "朴民秀", phone: "010-****-3456", addressKo: "대전시 유성구 대학로 78", addressZh: "大田市儒城区大学路78", invoice: "CJ-987654321", status: "shipDone" },
    ],
  },
  {
    order: "ORD-24833", product: "BT-2024-C", design: "DSN-089", qty: 300,
    cardSummary: { scanDone: 42, packing: 2, ejected: 38, error: 2 },
    cardLogs: [
      { time: "14:38:22", barcode: "CRD-0510", serial: "CS-C00142", printedQR: "CPQ-0510", status: "qrPrinted" },
      { time: "14:38:05", barcode: "CRD-0509", serial: "CS-C00141", printedQR: "-", status: "error" },
    ],
    setSummary: { matchWait: 38, packDone: 0, matchFail: 2 },
    setLogs: [],
    shipSummary: { invoiceWait: 0, shipDone: 0, shipHold: 0 },
    shipItems: [],
  },
  {
    order: "ORD-24834", product: "BT-2024-A", design: "DSN-047", qty: 120,
    cardSummary: { scanDone: 120, packing: 0, ejected: 120, error: 0 },
    cardLogs: [
      { time: "13:50:10", barcode: "CRD-0350", serial: "CS-A08200", printedQR: "CPQ-0350", status: "ejected" },
    ],
    setSummary: { matchWait: 0, packDone: 120, matchFail: 0 },
    setLogs: [
      { time: "14:10:20", setId: "SET-0250", tshirtQR: "DQR-0350", cardQR: "CPQ-0350", match: true, status: "packDone" },
    ],
    shipSummary: { invoiceWait: 13, shipDone: 95, shipHold: 0 },
    shipItems: [
      { setId: "SET-0250", recipientKo: "이영희", recipientZh: "李英姬", phone: "010-****-9012", addressKo: "부산시 해운대구 우동 567", addressZh: "釜山市海云台区佑洞567", invoice: "-", status: "invoiceWait" },
    ],
  },
];

const cardStatusBadge: Record<string, string> = {
  scanDone: "status-idle", packing: "status-warning", qrPrinted: "status-running", ejected: "status-running", error: "status-stopped",
};

function pct(a: number, b: number) { return b === 0 ? 0 : Math.round((a / b) * 100); }

/* ── Expandable order row ── */
function OrderRow({ o, children, summaryBadges, lang }: { o: OrderData; children: React.ReactNode; summaryBadges: React.ReactNode; lang: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="kpi-card section-enter">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <span className="font-semibold text-sm">{o.order}</span>
          <span className="text-xs text-muted-foreground">{o.product} · {o.design}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{lang === "ko" ? "수량" : "数量"}: {o.qty}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">{summaryBadges}</div>
      </button>
      {isOpen && <div className="mt-4 pt-4 border-t">{children}</div>}
    </div>
  );
}

export default function ProductionMonitor() {
  const { t, lang } = useLang();
  const [tab, setTab] = useState("pipeline");

  const [machines, setMachines] = useState([
    { id: "A-1", name: lang === "ko" ? "티셔츠 제작기 A-1" : "T恤制作机 A-1", status: "running", speed: "95", uptime: "97.2%", total: 38420, error: "-", lastComm: "14:37:05", stopReason: "", stoppedAt: "" },
    { id: "A-2", name: lang === "ko" ? "티셔츠 제작기 A-2" : "T恤制作机 A-2", status: "paused", speed: "-", uptime: "91.5%", total: 28150, error: "-", lastComm: "14:35:22", stopReason: "", stoppedAt: "" },
    { id: "A-3", name: lang === "ko" ? "티셔츠 제작기 A-3" : "T恤制作机 A-3", status: "running", speed: "92", uptime: "94.8%", total: 21560, error: "-", lastComm: "14:37:03", stopReason: "", stoppedAt: "" },
    { id: "B-1", name: lang === "ko" ? "카드 포장기 B-1" : "卡片包装机 B-1", status: "running", speed: "120", uptime: "96.1%", total: 42150, error: "-", lastComm: "14:37:01", stopReason: "", stoppedAt: "" },
    { id: "B-2", name: lang === "ko" ? "세트 포장기 B-2" : "套装包装机 B-2", status: "autoStopped", speed: "-", uptime: "93.4%", total: 31200, error: "QR-ERR", lastComm: "14:36:58", stopReason: lang === "ko" ? "QR 매칭 실패 — 홀로그램 QR ↔ 카드 바코드 불일치 (SET-0313)" : "QR匹配失败 — 全息QR ↔ 卡片条码不匹配 (SET-0313)", stoppedAt: "14:36:58" },
    { id: "B-3", name: lang === "ko" ? "택배 포장기 B-3" : "快递包装机 B-3", status: "running", speed: "78", uptime: "88.5%", total: 18300, error: "-", lastComm: "14:36:55", stopReason: "", stoppedAt: "" },
    { id: "B-4", name: lang === "ko" ? "송장 부착기 B-4" : "运单贴附机 B-4", status: "running", speed: "110", uptime: "95.7%", total: 35680, error: "-", lastComm: "14:37:04", stopReason: "", stoppedAt: "" },
  ]);
  const [actionMemos, setActionMemos] = useState<Record<string, string>>({});

  const stoppedMachines = machines.filter(m => m.status === "autoStopped");

  const handleRestart = (machineId: string) => {
    const memo = actionMemos[machineId]?.trim();
    if (!memo) {
      toast.error(t("machines.actionMemo"));
      return;
    }
    setMachines(prev => prev.map(m => m.id === machineId ? { ...m, status: "running", speed: "0", error: "-", stopReason: "", stoppedAt: "" } : m));
    setActionMemos(prev => ({ ...prev, [machineId]: "" }));
    toast.success(t("machines.restarted") + ` — ${machineId}`);
  };

  const statusMap: Record<string, { badge: string; icon: typeof Wifi; label: string }> = {
    running: { badge: "status-running", icon: Wifi, label: t("status.running") },
    stopped: { badge: "status-stopped", icon: WifiOff, label: t("status.stopped") },
    paused: { badge: "status-warning", icon: Gauge, label: t("status.paused") },
    error: { badge: "status-stopped", icon: AlertTriangle, label: t("status.error") },
    autoStopped: { badge: "status-stopped", icon: OctagonX, label: t("machines.autoStopped") },
    disconnected: { badge: "status-stopped", icon: WifiOff, label: t("status.disconnected") },
  };

  const cardStatusLabel: Record<string, string> = {
    scanDone: t("status.scanDone"), packing: t("status.packing"), qrPrinted: t("status.qrPrinted"), ejected: t("status.ejected"), error: t("status.error"),
  };
  const shippingStatusLabel: Record<string, string> = {
    invoiceWait: t("status.invoiceWait"), invoiceDone: t("status.invoiceDone"), shipDone: t("status.shipDone"), shipHold: t("status.shipHold"),
  };
  const shippingStatusBadge: Record<string, string> = {
    invoiceWait: "status-idle", invoiceDone: "status-warning", shipDone: "status-running", shipHold: "status-stopped",
  };

  return (
    <div>
      <PageHeader title={t("monitor.title")} description={t("monitor.desc")} />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="pipeline" className="gap-1.5"><Activity className="w-3.5 h-3.5" />{t("monitor.tab.pipeline")}</TabsTrigger>
            <TabsTrigger value="card" className="gap-1.5"><ScanLine className="w-3.5 h-3.5" />{t("monitor.tab.card")}</TabsTrigger>
            <TabsTrigger value="set" className="gap-1.5"><Package className="w-3.5 h-3.5" />{t("monitor.tab.set")}</TabsTrigger>
            <TabsTrigger value="shipping" className="gap-1.5"><Printer className="w-3.5 h-3.5" />{t("monitor.tab.shipping")}</TabsTrigger>
            <TabsTrigger value="machines" className="gap-1.5"><Gauge className="w-3.5 h-3.5" />{t("monitor.tab.machines")}</TabsTrigger>
          </TabsList>

          {/* ═══ Pipeline ═══ */}
          <TabsContent value="pipeline" className="space-y-6"><OrderPipeline /></TabsContent>

          {/* ═══ Card packing — by order ═══ */}
          <TabsContent value="card" className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: t("status.scanDone"), value: ordersData.reduce((s, o) => s + o.cardSummary.scanDone, 0), cls: "status-idle" },
                { label: t("status.packing"), value: ordersData.reduce((s, o) => s + o.cardSummary.packing, 0), cls: "status-warning" },
                { label: t("status.ejected"), value: ordersData.reduce((s, o) => s + o.cardSummary.ejected, 0), cls: "status-running" },
                { label: t("status.error"), value: ordersData.reduce((s, o) => s + o.cardSummary.error, 0), cls: "status-stopped" },
              ].map((s, i) => (
                <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
                  <p className="text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</p>
                  <span className={`status-badge mt-2 ${s.cls}`}>{s.label}</span>
                </div>
              ))}
            </div>
            {ordersData.map((o) => (
              <OrderRow key={o.order} o={o} lang={lang} summaryBadges={
                <>
                  <span className="text-xs tabular-nums text-muted-foreground">{o.cardSummary.ejected}/{o.qty}</span>
                  <div className="w-20 h-1.5 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct(o.cardSummary.ejected, o.qty)}%` }} />
                  </div>
                  <span className="text-xs font-medium tabular-nums">{pct(o.cardSummary.ejected, o.qty)}%</span>
                  {o.cardSummary.error > 0 && <span className="status-badge status-stopped">{t("status.error")} {o.cardSummary.error}</span>}
                </>
              }>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left">
                      {[t("cardPacking.time"), t("cardPacking.barcode"), t("cardPacking.serial"), t("cardPacking.printedQR"), t("cardPacking.status")].map(h => (
                        <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {o.cardLogs.map((l, i) => (
                        <tr key={i} className={`border-b last:border-0 ${l.status === "error" ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                          <td className="py-2 tabular-nums text-muted-foreground pr-4">{l.time}</td>
                          <td className="py-2 font-mono text-xs pr-4">{l.barcode}</td>
                          <td className="py-2 font-mono text-xs pr-4">{l.serial}</td>
                          <td className="py-2 font-mono text-xs pr-4">{l.printedQR}</td>
                          <td className="py-2"><span className={`status-badge ${cardStatusBadge[l.status]}`}>{cardStatusLabel[l.status]}</span></td>
                        </tr>
                      ))}
                      {o.cardLogs.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground text-sm">{lang === "ko" ? "아직 포장 기록이 없습니다" : "暂无包装记录"}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </OrderRow>
            ))}
          </TabsContent>

          {/* ═══ Set packing — by order ═══ */}
          <TabsContent value="set" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: t("setPacking.matchWait"), value: ordersData.reduce((s, o) => s + o.setSummary.matchWait, 0) },
                { label: t("setPacking.packDone"), value: ordersData.reduce((s, o) => s + o.setSummary.packDone, 0) },
                { label: t("setPacking.matchFail"), value: ordersData.reduce((s, o) => s + o.setSummary.matchFail, 0) },
              ].map((s, i) => (
                <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
                  <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
                </div>
              ))}
            </div>
            {ordersData.map((o) => (
              <OrderRow key={o.order} o={o} lang={lang} summaryBadges={
                <>
                  <span className="text-xs tabular-nums text-muted-foreground">{o.setSummary.packDone}/{o.qty}</span>
                  <div className="w-20 h-1.5 rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct(o.setSummary.packDone, o.qty)}%`, background: "hsl(152 60% 42%)" }} />
                  </div>
                  <span className="text-xs font-medium tabular-nums">{pct(o.setSummary.packDone, o.qty)}%</span>
                  {o.setSummary.matchFail > 0 && <span className="status-badge status-stopped">{t("setPacking.matchFail")} {o.setSummary.matchFail}</span>}
                </>
              }>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left">
                      {[t("setPacking.time"), t("setPacking.setId"), t("setPacking.tshirtQR"), t("setPacking.cardQR"), t("setPacking.match"), t("setPacking.status")].map(h => (
                        <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {o.setLogs.map((l, i) => (
                        <tr key={i} className={`border-b last:border-0 ${!l.match ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                          <td className="py-2 tabular-nums text-muted-foreground pr-4">{l.time}</td>
                          <td className="py-2 font-medium pr-4">{l.setId !== "-" ? <span className="text-primary">{l.setId}</span> : "-"}</td>
                          <td className="py-2 font-mono text-xs pr-4">{l.tshirtQR}</td>
                          <td className="py-2 font-mono text-xs pr-4">{l.cardQR}</td>
                          <td className="py-2 pr-4">{l.match ? <CheckCircle2 className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-destructive" />}</td>
                          <td className="py-2"><span className={`status-badge ${l.match ? "status-running" : "status-stopped"}`}>{l.status === "packDone" ? t("status.packDone") : t("status.matchFail")}</span></td>
                        </tr>
                      ))}
                      {o.setLogs.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground text-sm">{lang === "ko" ? "아직 세트 포장 기록이 없습니다" : "暂无套装包装记录"}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </OrderRow>
            ))}
          </TabsContent>

          {/* ═══ Shipping — by order ═══ */}
          <TabsContent value="shipping" className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("shipping.search")} />
              </div>
              <Button size="sm" variant="outline" className="gap-1.5"><Printer className="w-4 h-4" /> {t("shipping.batchPrint")}</Button>
            </div>
            {ordersData.map((o) => {
              const totalShip = o.shipSummary.invoiceWait + o.shipSummary.shipDone + o.shipSummary.shipHold;
              return (
                <OrderRow key={o.order} o={o} lang={lang} summaryBadges={
                  <>
                    {o.shipSummary.shipDone > 0 && <span className="status-badge status-running">{t("status.shipDone")} {o.shipSummary.shipDone}</span>}
                    {o.shipSummary.invoiceWait > 0 && <span className="status-badge status-idle">{t("status.invoiceWait")} {o.shipSummary.invoiceWait}</span>}
                    {o.shipSummary.shipHold > 0 && <span className="status-badge status-stopped">{t("status.shipHold")} {o.shipSummary.shipHold}</span>}
                    {totalShip === 0 && <span className="text-xs text-muted-foreground">{lang === "ko" ? "출고 대기" : "待出库"}</span>}
                  </>
                }>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-left">
                        {[t("shipping.setId"), t("shipping.recipient"), t("shipping.phone"), t("shipping.address"), t("shipping.invoiceNo"), t("shipping.status"), ""].map(h => (
                          <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {o.shipItems.map((s, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-2 font-mono text-xs pr-4">{s.setId}</td>
                            <td className="py-2 pr-4">{lang === "ko" ? s.recipientKo : s.recipientZh}</td>
                            <td className="py-2 text-muted-foreground pr-4">{s.phone}</td>
                            <td className="py-2 pr-4 max-w-[200px] truncate">{lang === "ko" ? s.addressKo : s.addressZh}</td>
                            <td className="py-2 font-mono text-xs pr-4">{s.invoice}</td>
                            <td className="py-2 pr-4"><span className={`status-badge ${shippingStatusBadge[s.status]}`}>{shippingStatusLabel[s.status]}</span></td>
                            <td className="py-2">{s.status === "invoiceWait" && <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Printer className="w-3 h-3" /> {t("shipping.print")}</Button>}</td>
                          </tr>
                        ))}
                        {o.shipItems.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-muted-foreground text-sm">{lang === "ko" ? "아직 출고 건이 없습니다" : "暂无出库记录"}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </OrderRow>
              );
            })}
          </TabsContent>

          {/* ═══ Machine status ═══ */}
          <TabsContent value="machines" className="space-y-6">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {machines.map((m, i) => {
                const st = statusMap[m.status] || statusMap.stopped;
                const StIcon = st.icon;
                return (
                  <div key={m.id} className="kpi-card section-enter" style={{ animationDelay: `${i * 80}ms` }}>
                    <div className="flex items-start justify-between mb-4">
                      <div><p className="font-medium">{m.name}</p><p className="text-xs text-muted-foreground">{m.id}</p></div>
                      <span className={`status-badge ${st.badge}`}><StIcon className="w-3 h-3" /> {st.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><p className="text-xs text-muted-foreground">{t("machines.speed")}</p><p className="font-medium tabular-nums">{m.speed !== "-" ? m.speed + t("common.perMin") : "-"}</p></div>
                      <div><p className="text-xs text-muted-foreground">{t("machines.uptime")}</p><p className="font-medium tabular-nums">{m.uptime}</p></div>
                      <div><p className="text-xs text-muted-foreground">{t("machines.totalWork")}</p><p className="font-medium tabular-nums">{m.total.toLocaleString()}</p></div>
                      <div><p className="text-xs text-muted-foreground">{t("machines.errorCode")}</p><p className={`font-medium ${m.error !== "-" ? "text-destructive" : ""}`}>{m.error}</p></div>
                    </div>
                    <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">{t("machines.lastComm")}: {m.lastComm}</div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
