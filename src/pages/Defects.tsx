import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, XCircle, CheckCircle2, RotateCcw, Trash2,
  Clock, ChevronDown, ChevronRight, Filter, ArrowRight,
  Package, Shirt, Box, Truck, Sticker
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";

type DefectType = "qr_mismatch" | "duplicate_qr" | "attach_fail" | "pack_fail" | "machine_error" | "material_short" | "print_fail";
type DefectStatus = "unprocessed" | "rework_queued" | "rework_in_progress" | "rework_done" | "disposed";
type RestartStage = "tshirt" | "card" | "set" | "courier" | "invoice";
type Severity = "high" | "medium" | "low";

interface DefectItem {
  id: string;
  orderNo: string;
  defectType: DefectType;
  severity: Severity;
  occurredAt: string;
  occurredProcess: string;
  detail: string;
  status: DefectStatus;
  restartStage: RestartStage | null;
  assignee: string;
  resolvedAt: string | null;
}

const stageOrder: RestartStage[] = ["tshirt", "card", "set", "courier", "invoice"];

export default function Defects() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";

  const defectTypeLabel: Record<DefectType, string> = {
    qr_mismatch: t("defects.qrMismatch"),
    duplicate_qr: t("defects.duplicateQR"),
    attach_fail: t("defects.attachFail"),
    pack_fail: t("defects.packFail"),
    machine_error: t("defects.commError"),
    material_short: t("defects.materialShort"),
    print_fail: t("defects.printFail"),
  };

  const stageLabel: Record<RestartStage, string> = {
    tshirt: t("process.tshirt"),
    card: t("process.card"),
    set: t("process.set"),
    courier: t("process.courier"),
    invoice: t("process.invoice"),
  };

  const stageIcon: Record<RestartStage, typeof Shirt> = {
    tshirt: Shirt,
    card: Sticker,
    set: Box,
    courier: Package,
    invoice: Truck,
  };

  const statusLabel: Record<DefectStatus, string> = {
    unprocessed: t("defects.statusUnprocessed"),
    rework_queued: t("defects.statusQueued"),
    rework_in_progress: t("defects.statusReworking"),
    rework_done: t("defects.statusReworkDone"),
    disposed: t("defects.statusDisposed"),
  };

  const statusCls: Record<DefectStatus, string> = {
    unprocessed: "status-stopped",
    rework_queued: "status-warning",
    rework_in_progress: "status-idle",
    rework_done: "status-running",
    disposed: "bg-muted text-muted-foreground",
  };

  const severityCls: Record<Severity, string> = {
    high: "bg-destructive/10 text-destructive",
    medium: "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]",
    low: "bg-muted text-muted-foreground",
  };

  const autoRestartMap: Record<DefectType, RestartStage> = {
    qr_mismatch: "tshirt",
    duplicate_qr: "tshirt",
    attach_fail: "tshirt",
    pack_fail: "card",
    machine_error: "card",
    material_short: "courier",
    print_fail: "invoice",
  };

  const [defects, setDefects] = useState<DefectItem[]>([
    { id: "EX-0235", orderNo: "20260324-1", defectType: "qr_mismatch", severity: "high", occurredAt: "14:32", occurredProcess: isKo ? "티셔츠 부착" : "T恤贴附", detail: isKo ? "실리콘QR SQR-00480 ↔ 디자인QR DQR-00479 상품코드 불일치" : "硅胶QR SQR-00480 ↔ 设计QR DQR-00479 商品代码不匹配", status: "unprocessed", restartStage: null, assignee: isKo ? "김민수" : "金民秀", resolvedAt: null },
    { id: "EX-0234", orderNo: "20260324-1", defectType: "duplicate_qr", severity: "high", occurredAt: "14:15", occurredProcess: isKo ? "티셔츠 부착" : "T恤贴附", detail: isKo ? "홀로그램QR HQR-A0929 이미 사용됨 (14:08 부착완료)" : "全息QR HQR-A0929 已使用（14:08贴附完成）", status: "rework_queued", restartStage: "tshirt", assignee: isKo ? "김민수" : "金民秀", resolvedAt: null },
    { id: "EX-0233", orderNo: "20260324-2", defectType: "pack_fail", severity: "medium", occurredAt: "13:58", occurredProcess: isKo ? "카드 포장" : "卡片包装", detail: isKo ? "카드 포장기 B-1 봉투 열접착 불량 (온도 미달)" : "卡片包装机B-1 封口热封不良（温度不足）", status: "rework_in_progress", restartStage: "card", assignee: isKo ? "이진호" : "李振浩", resolvedAt: null },
    { id: "EX-0232", orderNo: "20260324-3", defectType: "machine_error", severity: "medium", occurredAt: "13:42", occurredProcess: isKo ? "세트 포장" : "套装包装", detail: isKo ? "세트 포장기 B-2 통신 끊김 12분 경과" : "套装包装机B-2 通信中断已12分钟", status: "unprocessed", restartStage: null, assignee: isKo ? "박서윤" : "朴书允", resolvedAt: null },
    { id: "EX-0231", orderNo: "20260324-1", defectType: "material_short", severity: "low", occurredAt: "12:30", occurredProcess: isKo ? "택배 포장" : "快递包装", detail: isKo ? "택배봉투 재고 부족 (잔여 12매)" : "快递袋库存不足（剩余12个）", status: "rework_done", restartStage: "courier", assignee: isKo ? "최유진" : "崔有珍", resolvedAt: "13:15" },
    { id: "EX-0230", orderNo: "20260324-4", defectType: "print_fail", severity: "low", occurredAt: "11:50", occurredProcess: isKo ? "송장 부착" : "运单贴附", detail: isKo ? "프린터 용지 부족으로 송장 출력 실패" : "打印机缺纸导致运单打印失败", status: "disposed", restartStage: null, assignee: isKo ? "김민수" : "金民秀", resolvedAt: "12:10" },
  ]);

  const [activeTab, setActiveTab] = useState<"all" | "queue" | "history">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<Severity | "all">("all");

  const handleAddToReworkQueue = (id: string) => {
    setDefects(prev => prev.map(d => {
      if (d.id !== id) return d;
      const restart = autoRestartMap[d.defectType];
      return { ...d, status: "rework_queued" as DefectStatus, restartStage: restart };
    }));
  };

  const handleStartRework = (id: string) => {
    setDefects(prev => prev.map(d => d.id === id ? { ...d, status: "rework_in_progress" as DefectStatus } : d));
  };

  const handleCompleteRework = (id: string) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setDefects(prev => prev.map(d => d.id === id ? { ...d, status: "rework_done" as DefectStatus, resolvedAt: time } : d));
  };

  const handleDispose = (id: string) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setDefects(prev => prev.map(d => d.id === id ? { ...d, status: "disposed" as DefectStatus, resolvedAt: time } : d));
  };

  const filtered = defects.filter(d => {
    if (filterSeverity !== "all" && d.severity !== filterSeverity) return false;
    if (activeTab === "queue") return d.status === "rework_queued" || d.status === "rework_in_progress";
    if (activeTab === "history") return d.status === "rework_done" || d.status === "disposed";
    return true;
  });

  const counts = {
    unprocessed: defects.filter(d => d.status === "unprocessed").length,
    queued: defects.filter(d => d.status === "rework_queued" || d.status === "rework_in_progress").length,
    done: defects.filter(d => d.status === "rework_done").length,
    disposed: defects.filter(d => d.status === "disposed").length,
  };

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: "all", label: t("defects.tabAll") },
    { key: "queue", label: t("defects.tabQueue") },
    { key: "history", label: t("defects.tabHistory") },
  ];

  return (
    <div>
      <PageHeader title={t("defects.title")} description={t("defects.desc")}>
        <Button size="sm" className="gap-1.5"><AlertTriangle className="w-4 h-4" /> {t("defects.register")}</Button>
      </PageHeader>

      <div className="p-6 space-y-5">
        {/* KPI cards */}
        <div className="grid grid-cols-4 gap-3 section-enter">
          {[
            { label: t("defects.kpiUnprocessed"), value: counts.unprocessed, icon: XCircle, cls: "text-destructive" },
            { label: t("defects.kpiQueued"), value: counts.queued, icon: Clock, cls: "text-[hsl(var(--warning))]" },
            { label: t("defects.kpiReworkDone"), value: counts.done, icon: CheckCircle2, cls: "text-[hsl(var(--success))]" },
            { label: t("defects.kpiDisposed"), value: counts.disposed, icon: Trash2, cls: "text-muted-foreground" },
          ].map((s, i) => (
            <div key={s.label} className="kpi-card flex items-center gap-3" style={{ animationDelay: `${i * 50}ms` }}>
              <s.icon className={`w-5 h-5 shrink-0 ${s.cls}`} />
              <div>
                <p className="text-xl font-semibold tabular-nums">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs + filter */}
        <div className="flex items-center gap-3 section-enter" style={{ animationDelay: "80ms" }}>
          <div className="flex bg-muted rounded-lg p-0.5">
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === tab.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {(["all", "high", "medium", "low"] as const).map(s => (
              <button key={s} onClick={() => setFilterSeverity(s)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${filterSeverity === s ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                {s === "all" ? t("defects.filterAll") : s === "high" ? t("defects.filterHigh") : s === "medium" ? t("defects.filterMedium") : t("defects.filterLow")}
              </button>
            ))}
          </div>
        </div>

        {/* Defect list */}
        <div className="space-y-2 section-enter" style={{ animationDelay: "140ms" }}>
          {filtered.length === 0 && (
            <div className="kpi-card flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 opacity-30 mb-2" />
              <p className="text-sm">{t("defects.empty")}</p>
            </div>
          )}
          {filtered.map(d => {
            const isExpanded = expandedId === d.id;
            const restart = d.restartStage;
            return (
              <div key={d.id} className="kpi-card overflow-hidden">
                {/* Header row */}
                <button onClick={() => setExpandedId(isExpanded ? null : d.id)}
                  className="w-full flex items-center gap-3 text-left">
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <span className="text-sm font-semibold w-20 shrink-0">{d.id}</span>
                  <span className="text-xs text-muted-foreground w-28 shrink-0">{d.orderNo}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${severityCls[d.severity]}`}>
                    {d.severity === "high" ? t("defects.filterHigh") : d.severity === "medium" ? t("defects.filterMedium") : t("defects.filterLow")}
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted">{defectTypeLabel[d.defectType]}</span>
                  <span className="text-xs text-muted-foreground flex-1 truncate">{d.occurredProcess}</span>
                  <span className="text-xs tabular-nums text-muted-foreground w-12 text-right">{d.occurredAt}</span>
                  <span className={`status-badge shrink-0 ${statusCls[d.status]}`}>{statusLabel[d.status]}</span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t space-y-4">
                    {/* Detail */}
                    <div className="flex gap-6 text-sm">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-1">{t("defects.detailLabel")}</p>
                        <p>{d.detail}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">{t("defects.assigneeLabel")}</p>
                        <p className="font-medium">{d.assignee}</p>
                      </div>
                      {d.resolvedAt && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">{t("defects.resolvedAt")}</p>
                          <p className="font-medium tabular-nums">{d.resolvedAt}</p>
                        </div>
                      )}
                    </div>

                    {/* Restart stage visual */}
                    {restart && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">{t("defects.restartFrom")}</p>
                        <div className="flex items-center gap-1">
                          {stageOrder.map((stage, i) => {
                            const StIcon = stageIcon[stage];
                            const isRestart = stage === restart;
                            const isAfter = stageOrder.indexOf(stage) >= stageOrder.indexOf(restart);
                            return (
                              <div key={stage} className="flex items-center gap-1">
                                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                  isRestart ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                                  isAfter ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through"
                                }`}>
                                  <StIcon className="w-3.5 h-3.5" />
                                  {stageLabel[stage]}
                                </div>
                                {i < stageOrder.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {d.status === "unprocessed" && (
                        <>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => handleAddToReworkQueue(d.id)}>
                            <RotateCcw className="w-3.5 h-3.5" /> {t("defects.addToQueue")}
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => handleDispose(d.id)}>
                            <Trash2 className="w-3.5 h-3.5" /> {t("defects.dispose")}
                          </Button>
                        </>
                      )}
                      {d.status === "rework_queued" && (
                        <Button size="sm" className="gap-1" onClick={() => handleStartRework(d.id)}>
                          <RotateCcw className="w-3.5 h-3.5" /> {t("defects.startRework")}
                        </Button>
                      )}
                      {d.status === "rework_in_progress" && (
                        <Button size="sm" className="gap-1 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.9)] text-white" onClick={() => handleCompleteRework(d.id)}>
                          <CheckCircle2 className="w-3.5 h-3.5" /> {t("defects.completeRework")}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
