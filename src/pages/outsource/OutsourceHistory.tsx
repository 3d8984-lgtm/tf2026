import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import {
  ArrowLeft, ChevronRight, Inbox, Hammer, Package, Truck, CheckCircle2, Trash2,
} from "lucide-react";
import { useOrders } from "@/hooks/useDbData";
import {
  usePoCards, updatePoCard, removePoCard, type PoCard, type PoColumn,
} from "@/lib/po-cards";
import type { FactoryKey } from "@/hooks/useOrderStatus";

const FACTORY_LABEL_KO: Record<FactoryKey, string> = {
  "silicon": "실리콘 마크 공장",
  "heat-transfer": "열전사 디자인 공장",
  "hologram": "홀로그램 스티커 공장",
  "nfc-card": "NFC 카드 공장",
  "logo": "LOGO 공장",
  "tshirt-order": "주문 티셔츠 공장",
};
const FACTORY_LABEL_ZH: Record<FactoryKey, string> = {
  "silicon": "硅胶标识工厂",
  "heat-transfer": "热转印设计工厂",
  "hologram": "全息贴纸工厂",
  "nfc-card": "NFC卡片工厂",
  "logo": "LOGO工厂",
  "tshirt-order": "订单T恤工厂",
};
const FACTORY_DOT: Record<FactoryKey, string> = {
  "silicon": "hsl(205 75% 55%)",
  "heat-transfer": "hsl(15 80% 55%)",
  "hologram": "hsl(280 60% 60%)",
  "nfc-card": "hsl(160 60% 45%)",
  "logo": "hsl(45 90% 55%)",
  "tshirt-order": "hsl(340 70% 55%)",
};

// Trello green board bg
const BOARD_BG_GREEN = "#519839";

const COLUMNS: { key: PoColumn; ko: string; zh: string; icon: any }[] = [
  { key: "ordered",  ko: "발주완료", zh: "已发单",   icon: Inbox },
  { key: "started",  ko: "제작착수", zh: "开始制作", icon: Hammer },
  { key: "produced", ko: "제작완료", zh: "制作完成", icon: Package },
  { key: "shipped",  ko: "발송완료", zh: "已发货",   icon: Truck },
  { key: "received", ko: "수령확인", zh: "已收货",   icon: CheckCircle2 },
];

function fmtDate(s?: string | null) {
  if (!s) return "-";
  return String(s).slice(0, 10);
}

export default function OutsourceHistory() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const factoryLabel = isKo ? FACTORY_LABEL_KO : FACTORY_LABEL_ZH;

  const [params, setParams] = useSearchParams();
  const orderId = params.get("orderId");

  const { data: orders = [], isLoading } = useOrders();
  const { cards } = usePoCards();

  // Count POs per order
  const poCountByOrder = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cards) m[c.orderNo] = (m[c.orderNo] ?? 0) + 1;
    return m;
  }, [cards]);

  // Count per stage per order
  const stageCountByOrder = useMemo(() => {
    const m: Record<string, Record<PoColumn, number>> = {};
    for (const c of cards) {
      if (!m[c.orderNo]) m[c.orderNo] = { ordered: 0, started: 0, produced: 0, shipped: 0, received: 0 };
      m[c.orderNo][c.column] += 1;
    }
    return m;
  }, [cards]);

  const STAGE_COLORS: Record<PoColumn, string> = {
    ordered:  "bg-slate-500",
    started:  "bg-blue-500",
    produced: "bg-violet-500",
    shipped:  "bg-amber-500",
    received: "bg-emerald-500",
  };



  // -------- List view --------
  if (!orderId) {
    return (
      <div className="p-6 space-y-4">
        <PageHeader
          title={isKo ? "발주 이력 관리" : "发货历史管理"}
          description={isKo
            ? "주문을 선택해 각 공장 발주 카드를 트렐로 스타일 보드에서 관리합니다."
            : "选择订单以在 Trello 风格看板中管理各工厂发货卡片。"}
        />

        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">{isKo ? "작업번호" : "作业号"}</th>
                <th className="text-left px-3 py-2">{isKo ? "주문접수일" : "订单接收日"}</th>
                <th className="text-left px-3 py-2">{isKo ? "납기일" : "交期"}</th>
                <th className="text-left px-3 py-2">{isKo ? "트윈커" : "Twinker"}</th>
                <th className="text-right px-3 py-2">{isKo ? "주문수량" : "订单数量"}</th>
                <th className="text-center px-3 py-2">{isKo ? "발주 카드" : "发货卡片"}</th>
                <th className="text-left px-3 py-2">{isKo ? "발주 상태" : "发货状态"}</th>
                <th className="text-right px-3 py-2">{isKo ? "상세보기" : "详情"}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o: any) => {
                const stages = stageCountByOrder[o.external_order_id];
                const total = poCountByOrder[o.external_order_id] ?? 0;
                return (
                <tr key={o.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono">{o.external_order_id}</td>
                  <td className="px-3 py-2">{fmtDate(o.created_at)}</td>
                  <td className="px-3 py-2">{fmtDate(o.project_completed_at)}</td>
                  <td className="px-3 py-2">{o.recipient_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.quantity?.toLocaleString?.() ?? 0}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={total ? "default" : "outline"}>{total}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {total === 0 ? (
                      <span className="text-xs text-muted-foreground">{isKo ? "카드 없음" : "无卡片"}</span>
                    ) : (
                      <div className="space-y-1.5 min-w-[240px]">
                        {cards.filter(c => c.orderNo === o.external_order_id).map(c => {
                          const stageIdx = COLUMNS.findIndex(col => col.key === c.column);
                          const current = COLUMNS[stageIdx];
                          return (
                            <div key={`${c.factory}::${c.orderNo}`} className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: FACTORY_DOT[c.factory] }} />
                              <span className="text-[11px] truncate flex-1 min-w-0" title={(isKo ? FACTORY_LABEL_KO : FACTORY_LABEL_ZH)[c.factory]}>
                                {(isKo ? FACTORY_LABEL_KO : FACTORY_LABEL_ZH)[c.factory]}
                              </span>
                              <div className="flex gap-0.5 shrink-0" title={`${isKo ? current?.ko : current?.zh} (${stageIdx + 1}/5)`}>
                                {COLUMNS.map((col, i) => (
                                  <span
                                    key={col.key}
                                    className={`h-1.5 w-5 rounded-sm ${i <= stageIdx ? STAGE_COLORS[col.key] : "bg-muted"}`}
                                  />
                                ))}
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0 w-16 text-right">
                                {isKo ? current?.ko : current?.zh}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline"
                      onClick={() => setParams({ orderId: o.external_order_id })}>
                      {isKo ? "발주 관리" : "发货管理"} <ChevronRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </td>
                </tr>
                );
              })}
              {!isLoading && orders.length === 0 && (
                <tr><td colSpan={8} className="text-center text-muted-foreground py-8">
                  {isKo ? "주문이 없습니다" : "暂无订单"}
                </td></tr>
              )}

            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  // -------- Board view --------
  const order = orders.find((o: any) => o.external_order_id === orderId);
  const orderCards = cards.filter(c => c.orderNo === orderId);
  const grouped: Record<PoColumn, PoCard[]> = {
    ordered: [], started: [], produced: [], shipped: [], received: [],
  };
  for (const c of orderCards) grouped[c.column].push(c);

  return (
    <div className="min-h-screen" style={{ background: BOARD_BG_GREEN }}>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-white">
          <Button variant="secondary" size="sm" onClick={() => setParams({})}>
            <ArrowLeft className="w-4 h-4 mr-1" />{isKo ? "목록" : "列表"}
          </Button>
          <div className="ml-2">
            <div className="text-sm opacity-80">{isKo ? "발주 관리" : "发货管理"}</div>
            <div className="text-lg font-semibold font-mono">{orderId}</div>
          </div>
          {order && (
            <div className="ml-auto text-xs text-white/90 flex flex-wrap gap-2">
              <Badge className="bg-white/15 border-white/20 text-white">
                {isKo ? "트윈커" : "Twinker"}: {order.recipient_name}
              </Badge>
              <Badge className="bg-white/15 border-white/20 text-white">
                {isKo ? "주문수량" : "数量"}: {order.quantity?.toLocaleString?.()}
              </Badge>
              <Badge className="bg-white/15 border-white/20 text-white">
                {isKo ? "납기일" : "交期"}: {fmtDate(order.project_completed_at)}
              </Badge>
            </div>
          )}
        </div>

        <BoardDnd
          isKo={isKo}
          orderId={orderId}
          grouped={grouped}
          factoryLabel={factoryLabel}
        />
      </div>
    </div>
  );
}

function BoardDnd({
  isKo, orderId, grouped, factoryLabel,
}: {
  isKo: boolean;
  orderId: string;
  grouped: Record<PoColumn, PoCard[]>;
  factoryLabel: Record<FactoryKey, string>;
}) {
  const [dragging, setDragging] = useState<string | null>(null); // `${factory}::${orderNo}`
  const [overCol, setOverCol] = useState<PoColumn | null>(null);
  const [active, setActive] = useState<PoCard | null>(null);

  const moveTo = (factory: FactoryKey, orderNo: string, col: PoColumn) => {
    updatePoCard(factory, orderNo, { column: col });
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {COLUMNS.map(col => {
          const Icon = col.icon;
          const items = grouped[col.key];
          return (
            <div
              key={col.key}
              className={`rounded-lg flex flex-col min-h-[420px] transition-colors ${overCol === col.key ? "ring-2 ring-white/70" : ""}`}
              style={{ background: "rgba(0,0,0,0.12)" }}
              onDragOver={(e) => { e.preventDefault(); if (overCol !== col.key) setOverCol(col.key); }}
              onDragLeave={() => { if (overCol === col.key) setOverCol(null); }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragging;
                setOverCol(null); setDragging(null);
                if (!id) return;
                const [factory, orderNo] = id.split("::") as [FactoryKey, string];
                moveTo(factory, orderNo, col.key);
              }}
            >
              <div className="flex items-center gap-2 px-3 py-2.5 text-white">
                <Icon className="w-4 h-4 opacity-90" />
                <span className="text-sm font-semibold flex-1">{isKo ? col.ko : col.zh}</span>
                <Badge className="bg-white/20 border-white/30 text-white text-[10px]">{items.length}</Badge>
              </div>
              <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[72vh]">
                {items.map(c => {
                  const key = `${c.factory}::${c.orderNo}`;
                  return (
                    <div
                      key={key}
                      draggable
                      onDragStart={(e) => {
                        setDragging(key);
                        e.dataTransfer.setData("text/plain", key);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => { setDragging(null); setOverCol(null); }}
                      onClick={() => setActive(c)}
                      className={`bg-white rounded-md shadow-sm hover:shadow-md transition-all p-2.5 cursor-grab active:cursor-grabbing ${dragging === key ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: FACTORY_DOT[c.factory] }} />
                        <span className="text-[10px] text-muted-foreground truncate flex-1">{factoryLabel[c.factory]}</span>
                      </div>
                      <div className="text-xs font-semibold font-mono truncate">{c.orderNo}</div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                        <div>
                          <div className="text-[9px] uppercase opacity-70">{isKo ? "수량" : "数量"}</div>
                          <div className="tabular-nums text-foreground">{c.quantity?.toLocaleString?.() ?? "-"}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase opacity-70">{isKo ? "발주일" : "发单日"}</div>
                          <div className="text-foreground">{fmtDate(c.orderedAt)}</div>
                        </div>
                        <div className="col-span-2">
                          <div className="text-[9px] uppercase opacity-70">{isKo ? "예상 발송일" : "预计发货日"}</div>
                          <div className="text-foreground">{fmtDate(c.expectedShipAt) === "-" ? (isKo ? "미정" : "未定") : fmtDate(c.expectedShipAt)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="text-center text-[11px] text-white/70 py-6">
                    {isKo ? "카드 없음" : "无卡片"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(v) => !v && setActive(null)}>
        <DialogContent className="max-w-md">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: FACTORY_DOT[active.factory] }} />
                  <span className="font-mono">{active.orderNo}</span>
                  <Badge variant="secondary" className="text-[10px]">{factoryLabel[active.factory]}</Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "발주일" : "发单日期"}</Label>
                  <Input type="date" value={active.orderedAt ?? ""}
                    onChange={e => { updatePoCard(active.factory, active.orderNo, { orderedAt: e.target.value }); setActive({ ...active, orderedAt: e.target.value }); }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "예상 발송일" : "预计发货日"}</Label>
                  <Input type="date" value={active.expectedShipAt ?? ""}
                    onChange={e => { updatePoCard(active.factory, active.orderNo, { expectedShipAt: e.target.value }); setActive({ ...active, expectedShipAt: e.target.value }); }} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">{isKo ? "수량" : "数量"}</Label>
                  <Input type="number" value={active.quantity ?? 0}
                    onChange={e => { const q = Number(e.target.value) || 0; updatePoCard(active.factory, active.orderNo, { quantity: q }); setActive({ ...active, quantity: q }); }} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="destructive" size="sm"
                  onClick={() => { removePoCard(active.factory, active.orderNo); setActive(null); }}>
                  <Trash2 className="w-4 h-4 mr-1" />{isKo ? "카드 삭제" : "删除卡片"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
