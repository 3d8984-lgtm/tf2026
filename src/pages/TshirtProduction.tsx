import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { CheckCircle2, XCircle, Clock, ScanLine, ChevronDown, ChevronRight } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface ScanLog { time: string; color: string; size: string; silicon: string; design: string; hologram: string; result: "pass" | "fail"; logo: string; failReason?: string }
interface OrderData {
  order: string; product: string; designCode: string; qty: number; twinker: string; dueDate: string;
  summary: { waiting: number; done: number; fail: number };
  logs: ScanLog[];
}

const ordersData: OrderData[] = [
  {
    order: "20260324-1", product: "BT-2024-A", designCode: "DSN-047", qty: 200, twinker: "김민지", dueDate: "2026-03-25",
    summary: { waiting: 15, done: 182, fail: 3 },
    logs: [
      { time: "14:35:22", color: "Black", size: "L", silicon: "SQR-00482", design: "DQR-00482", hologram: "HQR-A0931", result: "pass", logo: "✓" },
      { time: "14:34:58", color: "Black", size: "L", silicon: "SQR-00481", design: "DQR-00481", hologram: "HQR-A0930", result: "pass", logo: "✓" },
      { time: "14:34:31", color: "Navy", size: "XL", silicon: "SQR-00480", design: "DQR-00479", hologram: "HQR-A0929", result: "fail", logo: "-" },
    ],
  },
  {
    order: "20260324-2", product: "BT-2024-B", designCode: "DSN-012", qty: 150, twinker: "박서연", dueDate: "2026-03-26",
    summary: { waiting: 0, done: 150, fail: 0 },
    logs: [
      { time: "14:34:02", color: "White", size: "M", silicon: "SQR-00479", design: "DQR-00479", hologram: "HQR-A0928", result: "pass", logo: "✓" },
      { time: "14:33:40", color: "White", size: "S", silicon: "SQR-00478", design: "DQR-00478", hologram: "HQR-A0927", result: "pass", logo: "✓" },
    ],
  },
  {
    order: "20260324-3", product: "BT-2024-C", designCode: "DSN-089", qty: 300, twinker: "이하윤", dueDate: "2026-03-27",
    summary: { waiting: 213, done: 83, fail: 4 },
    logs: [
      { time: "14:38:10", color: "Gray", size: "M", silicon: "SQR-00550", design: "DQR-00550", hologram: "HQR-C0083", result: "pass", logo: "✓" },
      { time: "14:37:48", color: "Gray", size: "L", silicon: "SQR-00549", design: "DQR-00548", hologram: "HQR-C0082", result: "fail", logo: "-" },
    ],
  },
  {
    order: "20260324-4", product: "BT-2024-A", designCode: "DSN-047", qty: 120, twinker: "최유진", dueDate: "2026-03-28",
    summary: { waiting: 0, done: 120, fail: 0 },
    logs: [
      { time: "13:45:20", color: "Black", size: "L", silicon: "SQR-00320", design: "DQR-00320", hologram: "HQR-A0800", result: "pass", logo: "✓" },
    ],
  },
];

function pct(a: number, b: number) { return b === 0 ? 0 : Math.round((a / b) * 100); }

function OrderRow({ o, t, lang }: { o: OrderData; t: (k: string) => string; lang: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const donePct = pct(o.summary.done, o.qty);
  const isDone = o.summary.waiting === 0 && o.summary.fail === 0;

  return (
    <div className="kpi-card section-enter">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <span className="font-semibold text-sm">{o.order}</span>
          <span className="text-xs text-muted-foreground">{lang === "ko" ? "트윈커" : "Twinker"}: <strong className="text-foreground">{o.twinker}</strong></span>
          <span className="text-xs text-muted-foreground">{lang === "ko" ? "납기" : "交期"}: {o.dueDate}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{lang === "ko" ? "수량" : "数量"}: {o.qty}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs tabular-nums text-muted-foreground">{o.summary.done}/{o.qty}</span>
          <div className="w-20 h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full transition-all" style={{ width: `${donePct}%`, background: isDone ? "hsl(var(--success))" : "hsl(var(--primary))" }} />
          </div>
          <span className="text-xs font-medium tabular-nums">{donePct}%</span>
          {o.summary.fail > 0 && <span className="status-badge status-stopped">{t("status.verifyFail")} {o.summary.fail}</span>}
        </div>
      </button>
      {isOpen && (
        <div className="mt-4 pt-4 border-t">
          {/* Mini stats */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{t("status.waiting")}</span>
              <span className="font-semibold tabular-nums">{o.summary.waiting}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className="text-muted-foreground">{t("status.attachDone")}</span>
              <span className="font-semibold tabular-nums">{o.summary.done}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <XCircle className="w-3.5 h-3.5 text-destructive" />
              <span className="text-muted-foreground">{t("status.verifyFail")}</span>
              <span className="font-semibold tabular-nums">{o.summary.fail}</span>
            </div>
          </div>
          {/* Log table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                {[t("tshirtProd.time"), lang === "ko" ? "색상" : "颜色", lang === "ko" ? "사이즈" : "尺码", t("tshirtProd.siliconQR"), t("tshirtProd.designQR"), t("tshirtProd.hologramQR"), t("tshirtProd.logoCol"), t("tshirtProd.result")].map(h => (
                  <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {o.logs.map((log, i) => (
                  <tr key={i} className={`border-b last:border-0 transition-colors ${log.result === "fail" ? "bg-destructive/5" : "hover:bg-muted/30"}`}>
                    <td className="py-2 tabular-nums text-muted-foreground pr-4">{log.time}</td>
                    <td className="py-2 pr-4">{log.color}</td>
                    <td className="py-2 pr-4">{log.size}</td>
                    <td className="py-2 font-mono text-xs pr-4">{log.silicon}</td>
                    <td className="py-2 font-mono text-xs pr-4">{log.design}</td>
                    <td className="py-2 font-mono text-xs pr-4">{log.hologram}</td>
                    <td className="py-2 pr-4">{log.logo}</td>
                    <td className="py-2">
                      <span className={`status-badge ${log.result === "pass" ? "status-running" : "status-stopped"}`}>
                        {log.result === "pass" ? t("status.attachDone") : t("status.verifyFail")}
                      </span>
                    </td>
                  </tr>
                ))}
                {o.logs.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-muted-foreground text-sm">{lang === "ko" ? "아직 작업 기록이 없습니다" : "暂无作业记录"}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TshirtProduction() {
  const { t, lang } = useLang();

  const totalStats = ordersData.reduce((acc, o) => ({
    waiting: acc.waiting + o.summary.waiting,
    done: acc.done + o.summary.done,
    fail: acc.fail + o.summary.fail,
  }), { waiting: 0, done: 0, fail: 0 });

  const stats = [
    { label: t("status.waiting"), count: totalStats.waiting, icon: Clock, cls: "status-idle" },
    { label: t("status.attachDone"), count: totalStats.done, icon: CheckCircle2, cls: "status-running" },
    { label: t("status.verifyFail"), count: totalStats.fail, icon: XCircle, cls: "status-stopped" },
  ];

  return (
    <div>
      <PageHeader title={t("tshirtProd.title")} description={t("tshirtProd.desc")} />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <div key={s.label} className="kpi-card section-enter flex items-center gap-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className={`p-2.5 rounded-lg ${s.cls}`}><s.icon className="w-5 h-5" /></div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{s.count}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {ordersData.map((o) => (
          <OrderRow key={o.order} o={o} t={t} lang={lang} />
        ))}
      </div>
    </div>
  );
}
