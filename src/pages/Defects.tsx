import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, XCircle, CheckCircle2, RotateCcw, Trash2,
  Clock, ChevronDown, ChevronRight, Filter, ArrowRight,
  Package, Shirt, Box, Truck, Sticker
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import DefectReviewPanel from "@/components/DefectReviewPanel";

type DefectType = "qr_mismatch" | "duplicate_qr" | "attach_fail" | "pack_fail" | "machine_error" | "material_short" | "print_fail";
type DefectStatus = "unprocessed" | "rework_queued" | "rework_in_progress" | "rework_done" | "disposed";
type RestartStage = "tshirt" | "card" | "set" | "courier" | "invoice";
type Severity = "high" | "medium" | "low";

interface DefectItem {
  id: string;
  orderNo: string;
  orderId: string | null;
  itemNo: string | null;
  seq: number | null;
  defectType: DefectType;
  severity: Severity;
  occurredAt: string;
  occurredProcess: string;
  detail: string;
  status: DefectStatus;
  restartStage: RestartStage | null;
  assignee: string;
  resolvedAt: string | null;
  rowId: string;
}

const stageOrder: RestartStage[] = ["tshirt", "card", "set", "courier", "invoice"];

export default function Defects() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const { canEditDefects } = usePermissions();

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

  const [activeTab, setActiveTab] = useState<"all" | "queue" | "history">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<Severity | "all">("all");
  const queryClient = useQueryClient();

  // Defect / rework logs recorded by the work stations.
  const { data: rows } = useQuery({
    queryKey: ["defect_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("defect_logs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const fmtTime = (v: string | null) =>
    v ? new Date(v).toLocaleString(isKo ? "ko-KR" : "zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

  const defects: DefectItem[] = (rows ?? []).map(r => ({
    id: (r.item_no as string) || (r.id as string).slice(0, 8),
    orderNo: (r.external_order_id as string) || "-",
    orderId: (r.order_id as string | null) ?? null,
    itemNo: (r.item_no as string | null) ?? null,
    seq: (r.seq as number | null) ?? null,

    defectType: (r.defect_type as DefectType) ?? "attach_fail",
    severity: (r.severity as Severity) ?? "medium",
    occurredAt: fmtTime(r.created_at as string) ?? "",
    occurredProcess: (r.occurred_process as string) || "-",
    detail: (r.detail as string) || "-",
    status: (r.status as DefectStatus) ?? "unprocessed",
    restartStage: (r.restart_stage as RestartStage) ?? null,
    assignee: (r.assignee as string) || "-",
    resolvedAt: fmtTime(r.resolved_at as string | null),
    rowId: r.id as string,
  }));

  const patchDefect = async (rowId: string, patch: { status?: string; restart_stage?: string; resolved_at?: string }) => {
    const { error } = await supabase.from("defect_logs").update(patch).eq("id", rowId);
    if (error) {
      toast({ title: isKo ? "저장 실패" : "保存失败", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["defect_logs"] });
  };

  const handleAddToReworkQueue = (rowId: string, type: DefectType) =>
    patchDefect(rowId, { status: "rework_queued", restart_stage: autoRestartMap[type] });

  const handleStartRework = (rowId: string) => patchDefect(rowId, { status: "rework_in_progress" });

  const handleCompleteRework = (rowId: string) =>
    patchDefect(rowId, { status: "rework_done", resolved_at: new Date().toISOString() });

  const handleDispose = (rowId: string) =>
    patchDefect(rowId, { status: "disposed", resolved_at: new Date().toISOString() });

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
            const isExpanded = expandedId === d.rowId;
            const restart = d.restartStage;
            return (
              <div key={d.rowId} className="kpi-card overflow-hidden">
                {/* Header row */}
                <button onClick={() => setExpandedId(isExpanded ? null : d.rowId)}
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

                {/* Expanded detail: inspector review (video + scan result) */}
                {isExpanded && (
                  <DefectReviewPanel
                    rowId={d.rowId}
                    orderId={d.orderId}
                    externalOrderId={d.orderNo === "-" ? null : d.orderNo}
                    itemNo={d.itemNo}
                    seq={d.seq}
                    detail={d.detail}
                    isKo={isKo}
                    canEdit={canEditDefects}
                  />
                )}

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
