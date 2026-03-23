import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLang } from "@/contexts/LangContext";
import OrderPipeline from "@/components/OrderPipeline";
import {
  Wifi, WifiOff, Gauge, AlertTriangle, ScanLine, Package,
  CheckCircle2, XCircle, Printer, Search, Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ── Card Packing data ── */
const packLogs = [
  { time: "14:36:01", barcode: "CRD-20240315-0482", serial: "CS-A09312", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0482", status: "ejected" },
  { time: "14:35:42", barcode: "CRD-20240315-0481", serial: "CS-A09311", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0481", status: "ejected" },
  { time: "14:35:20", barcode: "CRD-20240315-0480", serial: "CS-A09310", product: "BT-2024-B", design: "DSN-012", printedQR: "-", status: "error" },
  { time: "14:34:58", barcode: "CRD-20240315-0479", serial: "CS-A09309", product: "BT-2024-A", design: "DSN-047", printedQR: "CPQ-0479", status: "qrPrinted" },
];

const cardStatusBadge: Record<string, string> = {
  scanDone: "status-idle", packing: "status-warning", qrPrinted: "status-running", ejected: "status-running", error: "status-stopped",
};

/* ── Set Packing data ── */
const setLogs = [
  { time: "14:37:01", setId: "SET-20240315-0312", tshirtQR: "DQR-00482", cardQR: "CPQ-0482", product: "BT-2024-A", design: "DSN-047", match: true, status: "packDone" },
  { time: "14:36:38", setId: "SET-20240315-0311", tshirtQR: "DQR-00481", cardQR: "CPQ-0481", product: "BT-2024-A", design: "DSN-047", match: true, status: "packDone" },
  { time: "14:36:12", setId: "-", tshirtQR: "DQR-00480", cardQR: "CPQ-0478", product: "BT-2024-A / BT-2024-B", design: "DSN-047 / DSN-012", match: false, status: "matchFail" },
  { time: "14:35:50", setId: "SET-20240315-0310", tshirtQR: "DQR-00479", cardQR: "CPQ-0479", product: "BT-2024-B", design: "DSN-012", match: true, status: "packDone" },
];

/* ── Shipping data ── */
const shipmentsBase = [
  { order: "ORD-24831", setId: "SET-20240315-0312", recipientKo: "홍길동", recipientZh: "洪吉童", phone: "010-****-5678", addressKo: "서울시 강남구 역삼동 123-4", addressZh: "首尔市江南区驿三洞123-4", product: "BT-2024-A", invoice: "CJ-123456789", status: "shipDone" },
  { order: "ORD-24832", setId: "SET-20240315-0311", recipientKo: "김철수", recipientZh: "金哲秀", phone: "010-****-1234", addressKo: "경기도 성남시 분당구 판교로 45", addressZh: "京畿道城南市盆唐区板桥路45", product: "BT-2024-A", invoice: "-", status: "invoiceWait" },
  { order: "ORD-24833", setId: "SET-20240315-0310", recipientKo: "이영희", recipientZh: "李英姬", phone: "010-****-9012", addressKo: "부산시 해운대구 우동 567", addressZh: "釜山市海云台区佑洞567", product: "BT-2024-B", invoice: "-", status: "shipHold" },
];

export default function ProductionMonitor() {
  const { t, lang } = useLang();
  const [tab, setTab] = useState("pipeline");

  /* ── Machine data ── */
  const machines = [
    { id: "A-1", name: lang === "ko" ? "티셔츠 제작기 A-1" : "T恤制作机 A-1", status: "running", speed: "95", uptime: "97.2%", total: 38420, error: "-", lastComm: "14:37:05" },
    { id: "A-2", name: lang === "ko" ? "티셔츠 제작기 A-2" : "T恤制作机 A-2", status: "paused", speed: "-", uptime: "91.5%", total: 28150, error: "-", lastComm: "14:35:22" },
    { id: "A-3", name: lang === "ko" ? "티셔츠 제작기 A-3" : "T恤制作机 A-3", status: "running", speed: "92", uptime: "94.8%", total: 21560, error: "-", lastComm: "14:37:03" },
    { id: "B-1", name: lang === "ko" ? "카드 포장기 B-1" : "卡片包装机 B-1", status: "running", speed: "120", uptime: "96.1%", total: 42150, error: "-", lastComm: "14:37:01" },
    { id: "B-2", name: lang === "ko" ? "세트 포장기 B-2" : "套装包装机 B-2", status: "running", speed: "85", uptime: "93.4%", total: 31200, error: "-", lastComm: "14:36:58" },
    { id: "B-3", name: lang === "ko" ? "택배 포장기 B-3" : "快递包装机 B-3", status: "running", speed: "78", uptime: "88.5%", total: 18300, error: "-", lastComm: "14:36:55" },
    { id: "B-4", name: lang === "ko" ? "송장 부착기 B-4" : "运单贴附机 B-4", status: "running", speed: "110", uptime: "95.7%", total: 35680, error: "-", lastComm: "14:37:04" },
  ];

  const statusMap: Record<string, { badge: string; icon: typeof Wifi; label: string }> = {
    running: { badge: "status-running", icon: Wifi, label: t("status.running") },
    stopped: { badge: "status-stopped", icon: WifiOff, label: t("status.stopped") },
    paused: { badge: "status-warning", icon: Gauge, label: t("status.paused") },
    error: { badge: "status-stopped", icon: AlertTriangle, label: t("status.error") },
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

  const shipments = shipmentsBase.map(s => ({
    ...s,
    recipient: lang === "ko" ? s.recipientKo : s.recipientZh,
    address: lang === "ko" ? s.addressKo : s.addressZh,
  }));

  return (
    <div>
      <PageHeader title={t("monitor.title")} description={t("monitor.desc")} />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="pipeline" className="gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              {t("monitor.tab.pipeline")}
            </TabsTrigger>
            <TabsTrigger value="card" className="gap-1.5">
              <ScanLine className="w-3.5 h-3.5" />
              {t("monitor.tab.card")}
            </TabsTrigger>
            <TabsTrigger value="set" className="gap-1.5">
              <Package className="w-3.5 h-3.5" />
              {t("monitor.tab.set")}
            </TabsTrigger>
            <TabsTrigger value="shipping" className="gap-1.5">
              <Printer className="w-3.5 h-3.5" />
              {t("monitor.tab.shipping")}
            </TabsTrigger>
            <TabsTrigger value="machines" className="gap-1.5">
              <Gauge className="w-3.5 h-3.5" />
              {t("monitor.tab.machines")}
            </TabsTrigger>
          </TabsList>

          {/* ═══ Pipeline overview ═══ */}
          <TabsContent value="pipeline" className="space-y-6">
            <OrderPipeline />
          </TabsContent>

          {/* ═══ Card packing ═══ */}
          <TabsContent value="card" className="space-y-6">
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: t("status.scanDone"), value: 1247, cls: "status-idle" },
                { label: t("status.packing"), value: 3, cls: "status-warning" },
                { label: t("status.ejected"), value: 1198, cls: "status-running" },
                { label: t("status.error"), value: 4, cls: "status-stopped" },
              ].map((s, i) => (
                <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
                  <p className="text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</p>
                  <span className={`status-badge mt-2 ${s.cls}`}>{s.label}</span>
                </div>
              ))}
            </div>
            <div className="kpi-card section-enter" style={{ animationDelay: "260ms" }}>
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2"><ScanLine className="w-4 h-4" /> {t("cardPacking.log")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      {[t("cardPacking.time"), t("cardPacking.barcode"), t("cardPacking.serial"), t("cardPacking.productCode"), t("cardPacking.designCode"), t("cardPacking.printedQR"), t("cardPacking.status")].map(h => (
                        <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {packLogs.map((l, i) => (
                      <tr key={i} className={`border-b last:border-0 ${l.status === "error" ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                        <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{l.time}</td>
                        <td className="py-2.5 font-mono text-xs pr-4">{l.barcode}</td>
                        <td className="py-2.5 font-mono text-xs pr-4">{l.serial}</td>
                        <td className="py-2.5 pr-4">{l.product}</td>
                        <td className="py-2.5 pr-4">{l.design}</td>
                        <td className="py-2.5 font-mono text-xs pr-4">{l.printedQR}</td>
                        <td className="py-2.5"><span className={`status-badge ${cardStatusBadge[l.status]}`}>{cardStatusLabel[l.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ═══ Set packing ═══ */}
          <TabsContent value="set" className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: t("setPacking.matchWait"), value: 178 },
                { label: t("setPacking.packDone"), value: 654 },
                { label: t("setPacking.matchFail"), value: 3 },
              ].map((s, i) => (
                <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
                  <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="kpi-card section-enter" style={{ animationDelay: "200ms" }}>
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2"><Package className="w-4 h-4" /> {t("setPacking.matchLog")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      {[t("setPacking.time"), t("setPacking.setId"), t("setPacking.tshirtQR"), t("setPacking.cardQR"), t("setPacking.productCode"), t("setPacking.designCode"), t("setPacking.match"), t("setPacking.status")].map(h => (
                        <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {setLogs.map((l, i) => (
                      <tr key={i} className={`border-b last:border-0 ${!l.match ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}>
                        <td className="py-2.5 tabular-nums text-muted-foreground pr-4">{l.time}</td>
                        <td className="py-2.5 font-medium pr-4">{l.setId !== "-" ? <span className="text-primary">{l.setId}</span> : "-"}</td>
                        <td className="py-2.5 font-mono text-xs pr-4">{l.tshirtQR}</td>
                        <td className="py-2.5 font-mono text-xs pr-4">{l.cardQR}</td>
                        <td className="py-2.5 pr-4">{l.product}</td>
                        <td className="py-2.5 pr-4">{l.design}</td>
                        <td className="py-2.5 pr-4">{l.match ? <CheckCircle2 className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-destructive" />}</td>
                        <td className="py-2.5"><span className={`status-badge ${l.match ? "status-running" : "status-stopped"}`}>{l.status === "packDone" ? t("status.packDone") : t("status.matchFail")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ═══ Shipping ═══ */}
          <TabsContent value="shipping" className="space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("shipping.search")} />
              </div>
              <Button size="sm" variant="outline" className="gap-1.5"><Printer className="w-4 h-4" /> {t("shipping.batchPrint")}</Button>
            </div>
            <div className="kpi-card section-enter">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      {[t("shipping.orderNo"), t("shipping.setId"), t("shipping.recipient"), t("shipping.phone"), t("shipping.address"), t("shipping.product"), t("shipping.invoiceNo"), t("shipping.status"), ""].map(h => (
                        <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.map((s) => (
                      <tr key={s.order} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 font-medium text-primary pr-4">{s.order}</td>
                        <td className="py-2.5 font-mono text-xs pr-4">{s.setId}</td>
                        <td className="py-2.5 pr-4">{s.recipient}</td>
                        <td className="py-2.5 text-muted-foreground pr-4">{s.phone}</td>
                        <td className="py-2.5 pr-4 max-w-[200px] truncate">{s.address}</td>
                        <td className="py-2.5 pr-4">{s.product}</td>
                        <td className="py-2.5 font-mono text-xs pr-4">{s.invoice}</td>
                        <td className="py-2.5 pr-4"><span className={`status-badge ${shippingStatusBadge[s.status]}`}>{shippingStatusLabel[s.status]}</span></td>
                        <td className="py-2.5">
                          {s.status === "invoiceWait" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Printer className="w-3 h-3" /> {t("shipping.print")}</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
                      <div>
                        <p className="font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.id}</p>
                      </div>
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
