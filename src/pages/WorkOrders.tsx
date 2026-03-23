import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Plus, Search, RotateCcw, ChevronDown, ChevronRight,
  ArrowRight, Shirt, Sticker, Box, Package, Truck, AlertTriangle
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";

type RestartStage = "tshirt" | "card" | "set" | "courier" | "invoice";

interface ReworkItem {
  defectId: string;
  defectType: string;
  detail: string;
  restartStage: RestartStage;
  status: "queued" | "in_progress" | "done";
  addedAt: string;
}

interface WorkOrder {
  id: string;
  product: string;
  design: string;
  qty: number;
  date: string;
  line: string;
  assignee: string;
  status: string;
  reworks: ReworkItem[];
}

const stageOrder: RestartStage[] = ["tshirt", "card", "set", "courier", "invoice"];
const stageIcons: Record<RestartStage, typeof Shirt> = { tshirt: Shirt, card: Sticker, set: Box, courier: Package, invoice: Truck };

export default function WorkOrders() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";

  const stageLabel: Record<RestartStage, string> = {
    tshirt: t("process.tshirt"), card: t("process.card"), set: t("process.set"),
    courier: t("process.courier"), invoice: t("process.invoice"),
  };

  const [workOrders] = useState<WorkOrder[]>([
    {
      id: "WO-20240315-001", product: "BT-2024-A", design: "DSN-047", qty: 500, date: "2024-03-15",
      line: isKo ? "라인 A" : "产线 A", assignee: isKo ? "김작업" : "金作业", status: "inProgress",
      reworks: [
        { defectId: "EX-0235", defectType: isKo ? "QR 불일치" : "QR不匹配", detail: isKo ? "실리콘QR SQR-00480 ↔ 디자인QR DQR-00479 상품코드 불일치" : "硅胶QR SQR-00480 ↔ 设计QR DQR-00479 商品代码不匹配", restartStage: "tshirt", status: "queued", addedAt: "14:35" },
        { defectId: "EX-0234", defectType: isKo ? "중복 QR 사용" : "重复QR", detail: isKo ? "홀로그램QR HQR-A0929 이미 사용됨" : "全息QR HQR-A0929 已使用", restartStage: "tshirt", status: "in_progress", addedAt: "14:18" },
      ],
    },
    {
      id: "WO-20240315-002", product: "BT-2024-B", design: "DSN-012", qty: 300, date: "2024-03-15",
      line: isKo ? "라인 B" : "产线 B", assignee: isKo ? "이작업" : "李作业", status: "waiting",
      reworks: [],
    },
    {
      id: "WO-20240315-003", product: "BT-2024-C", design: "DSN-089", qty: 200, date: "2024-03-15",
      line: isKo ? "라인 A" : "产线 A", assignee: isKo ? "박작업" : "朴作业", status: "inProgress",
      reworks: [
        { defectId: "EX-0233", defectType: isKo ? "포장 불량" : "包装不良", detail: isKo ? "카드 포장기 B-1 봉투 열접착 불량" : "卡片包装机B-1封口热封不良", restartStage: "card", status: "queued", addedAt: "14:02" },
      ],
    },
    {
      id: "WO-20240314-005", product: "BT-2024-C", design: "DSN-089", qty: 800, date: "2024-03-14",
      line: isKo ? "라인 A" : "产线 A", assignee: isKo ? "김작업" : "金作业", status: "completed",
      reworks: [
        { defectId: "EX-0231", defectType: isKo ? "자재 부족" : "材料不足", detail: isKo ? "택배봉투 재고 부족" : "快递袋库存不足", restartStage: "courier", status: "done", addedAt: "12:33" },
      ],
    },
  ]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const statusBadge = (status: string) => {
    if (status === "inProgress") return { label: t("status.inProgress"), cls: "status-running" };
    if (status === "waiting") return { label: t("status.waiting"), cls: "status-idle" };
    return { label: t("status.completed"), cls: "status-running" };
  };

  const reworkStatusCls: Record<string, string> = {
    queued: "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]",
    in_progress: "bg-primary/10 text-primary",
    done: "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]",
  };
  const reworkStatusLabel: Record<string, string> = {
    queued: t("defects.statusQueued"),
    in_progress: t("defects.statusReworking"),
    done: t("defects.statusReworkDone"),
  };

  const filtered = workOrders.filter(wo =>
    !search || wo.id.toLowerCase().includes(search.toLowerCase()) || wo.product.toLowerCase().includes(search.toLowerCase())
  );

  const totalReworks = workOrders.reduce((a, wo) => a + wo.reworks.filter(r => r.status !== "done").length, 0);

  const headers = [
    t("workOrders.orderNo"), t("workOrders.productCode"), t("workOrders.designCode"),
    t("workOrders.qty"), t("workOrders.workDate"), t("workOrders.line"),
    t("workOrders.assignee"), t("workOrders.status"), t("workOrders.reworkCol"),
  ];

  return (
    <div>
      <PageHeader title={t("workOrders.title")} description={t("workOrders.desc")}>
        <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> {t("workOrders.create")}</Button>
      </PageHeader>
      <div className="p-6 space-y-5">
        {/* Rework alert banner */}
        {totalReworks > 0 && (
          <div className="kpi-card section-enter flex items-center gap-3 border-l-4 border-l-[hsl(var(--warning))]">
            <RotateCcw className="w-5 h-5 text-[hsl(var(--warning))] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{t("workOrders.reworkAlert")}</p>
              <p className="text-xs text-muted-foreground">{t("workOrders.reworkAlertDesc").replace("{n}", String(totalReworks))}</p>
            </div>
            <span className="text-lg font-bold tabular-nums text-[hsl(var(--warning))]">{totalReworks}</span>
          </div>
        )}

        <div className="kpi-card section-enter" style={{ animationDelay: "80ms" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("workOrders.search")} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-2 w-8"></th>
                  {headers.map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map(wo => {
                  const isExpanded = expandedId === wo.id;
                  const sb = statusBadge(wo.status);
                  const activeReworks = wo.reworks.filter(r => r.status !== "done").length;
                  return (
                    <React.Fragment key={wo.id}>
                      <tr
                        className={`border-b hover:bg-muted/30 transition-colors cursor-pointer ${activeReworks > 0 ? "bg-[hsl(var(--warning)/0.03)]" : ""}`}
                        onClick={() => setExpandedId(isExpanded ? null : wo.id)}
                      >
                        <td className="py-2.5 pr-2">
                          {wo.reworks.length > 0 ? (
                            isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          ) : <span className="w-4 h-4 block" />}
                        </td>
                        <td className="py-2.5 font-medium text-primary pr-4">{wo.id}</td>
                        <td className="py-2.5 pr-4">{wo.product}</td>
                        <td className="py-2.5 pr-4">{wo.design}</td>
                        <td className="py-2.5 tabular-nums pr-4">{wo.qty.toLocaleString()}</td>
                        <td className="py-2.5 text-muted-foreground pr-4">{wo.date}</td>
                        <td className="py-2.5 pr-4">{wo.line}</td>
                        <td className="py-2.5 pr-4">{wo.assignee}</td>
                        <td className="py-2.5 pr-4"><span className={`status-badge ${sb.cls}`}>{sb.label}</span></td>
                        <td className="py-2.5">
                          {activeReworks > 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]">
                              <AlertTriangle className="w-3 h-3" /> {activeReworks}{isKo ? "건" : "件"}
                            </span>
                          ) : wo.reworks.length > 0 ? (
                            <span className="text-xs text-muted-foreground">{t("workOrders.reworkResolved")}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                      {/* Expanded rework rows */}
                      {isExpanded && wo.reworks.length > 0 && (
                        <tr>
                          <td colSpan={headers.length + 1} className="p-0">
                            <div className="bg-muted/20 border-y px-6 py-4 space-y-3">
                              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                <RotateCcw className="w-3.5 h-3.5" /> {t("workOrders.reworkList")} ({wo.reworks.length})
                              </p>
                              {wo.reworks.map(rw => {
                                const StageIcon = stageIcons[rw.restartStage];
                                return (
                                  <div key={rw.defectId} className="bg-background rounded-lg p-3 flex items-start gap-3">
                                    <div className="shrink-0 mt-0.5">
                                      <AlertTriangle className={`w-4 h-4 ${rw.status === "done" ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}`} />
                                    </div>
                                    <div className="flex-1 min-w-0 space-y-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold">{rw.defectId}</span>
                                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted">{rw.defectType}</span>
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${reworkStatusCls[rw.status]}`}>{reworkStatusLabel[rw.status]}</span>
                                        <span className="text-xs tabular-nums text-muted-foreground ml-auto">{rw.addedAt}</span>
                                      </div>
                                      <p className="text-xs text-muted-foreground">{rw.detail}</p>
                                      {/* Restart stage flow */}
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <span className="text-xs text-muted-foreground mr-1">{t("defects.restartFrom")}:</span>
                                        {stageOrder.map((stage, i) => {
                                          const SIcon = stageIcons[stage];
                                          const isRestart = stage === rw.restartStage;
                                          const isAfter = stageOrder.indexOf(stage) >= stageOrder.indexOf(rw.restartStage);
                                          return (
                                            <div key={stage} className="flex items-center gap-0.5">
                                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${
                                                isRestart ? "bg-primary text-primary-foreground" :
                                                isAfter ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through"
                                              }`}>
                                                <SIcon className="w-3 h-3" />{stageLabel[stage]}
                                              </span>
                                              {i < stageOrder.length - 1 && <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

import React from "react";
