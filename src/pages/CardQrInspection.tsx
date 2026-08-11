import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useOrders } from "@/hooks/useDbData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, CheckCircle2, XCircle, RotateCcw, ChevronLeft, Shuffle, Circle } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

interface CardItem {
  card_barcode: string;
  card_serial: string;
  hologram_qr: string;
  design_qr: string;
}

interface OrderRow {
  id: string;
  externalOrderId: string;
  twinker: string;
  product: string;
  dueDate: string;
  items: CardItem[];
}

/** 한 회차 = 연속 3장 (수량이 3 미만이면 수량만큼) */
interface Round {
  start: number; // 0-based index of first card in the round
  size: number;
}

interface Plan {
  orderId: string;
  total: number;
  rounds: Round[];
}

interface RoundResult {
  round: number;
  at: number;
  expected: string[];
  scanned: string[];
  ok: boolean;
  reason: string;
}

interface HistoryEntry extends RoundResult {
  id: string;
  orderId: string;
}

const PLAN_KEY = "card-dm-order-plan-v1";
const HISTORY_KEY = "card-dm-order-history-v1";

/** 수량별 검사 회차: 5개 이하 1회, 10개 이하 2회, 그 외 3회 */
export function roundsFor(total: number) {
  if (total <= 0) return 0;
  if (total <= 5) return 1;
  if (total <= 10) return 2;
  return 3;
}

function buildPlan(orderId: string, total: number): Plan {
  const count = roundsFor(total);
  const size = Math.min(3, total);
  const maxStart = Math.max(0, total - size);
  const starts: number[] = [];
  let guard = 0;
  while (starts.length < count && guard++ < 500) {
    const s = Math.floor(Math.random() * (maxStart + 1));
    // 회차끼리 겹치지 않도록 (가능한 경우에만)
    const overlaps = starts.some(x => Math.abs(x - s) < size);
    if (overlaps && maxStart + 1 > count * size) continue;
    if (starts.includes(s)) continue;
    starts.push(s);
  }
  starts.sort((a, b) => a - b);
  return { orderId, total, rounds: starts.map(start => ({ start, size })) };
}

const norm = (v: string) => (v || "").trim().toUpperCase();

export default function CardQrInspection() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const t = (ko: string, zh: string) => (isKo ? ko : zh);

  const { data: dbOrders } = useOrders();

  const orders = useMemo<OrderRow[]>(() => {
    if (!dbOrders) return [];
    return dbOrders.map((o: any) => {
      const items: CardItem[] = ((o.source_data as any)?.items ?? []).map((it: any) => ({
        card_barcode: it.card_barcode ?? "",
        card_serial: it.card_serial ?? "",
        hologram_qr: it.hologram_qr ?? "",
        design_qr: it.design_qr ?? "",
      }));
      return {
        id: o.id,
        externalOrderId: o.external_order_id,
        twinker: o.recipient_name,
        product: o.product_code,
        dueDate: o.project_completed_at
          ? new Date(o.project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN")
          : "-",
        items,
      };
    });
  }, [dbOrders, isKo]);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const order = orders.find(o => o.id === selectedOrderId) ?? null;

  // ── 표본 계획 (주문별 localStorage) ────────────────────────────────
  const [plans, setPlans] = useState<Record<string, Plan>>(() => {
    try { return JSON.parse(localStorage.getItem(PLAN_KEY) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(plans)); } catch {}
  }, [plans]);

  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  }, [history]);

  const plan = order ? plans[order.id] : undefined;

  // 주문 선택 시 계획 없으면 자동 생성
  useEffect(() => {
    if (!order) return;
    const p = plans[order.id];
    if (!p || p.total !== order.items.length) {
      setPlans(prev => ({ ...prev, [order.id]: buildPlan(order.id, order.items.length) }));
    }
  }, [order, plans]);

  const orderHistory = useMemo(
    () => (order ? history.filter(h => h.orderId === order.id) : []),
    [history, order]
  );

  // 완료된 회차 = 이력에 남은 회차 번호 집합
  const doneRounds = useMemo(() => {
    const m = new Map<number, HistoryEntry>();
    for (let i = orderHistory.length - 1; i >= 0; i--) m.set(orderHistory[i].round, orderHistory[i]);
    return m;
  }, [orderHistory]);

  const currentRound = useMemo(() => {
    if (!plan) return -1;
    for (let i = 0; i < plan.rounds.length; i++) if (!doneRounds.has(i)) return i;
    return -1;
  }, [plan, doneRounds]);

  const [scans, setScans] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [order, scans.length, currentRound]);
  useEffect(() => { setScans([]); setInput(""); }, [selectedOrderId]);

  const expectedItems = useMemo(() => {
    if (!order || !plan || currentRound < 0) return [] as CardItem[];
    const r = plan.rounds[currentRound];
    return order.items.slice(r.start, r.start + r.size);
  }, [order, plan, currentRound]);

  const keysOf = (it: CardItem) =>
    [it.card_barcode, `${it.card_barcode}-4`, it.hologram_qr, it.card_serial, it.design_qr]
      .filter(Boolean).map(norm);

  const finishRound = useCallback((codes: string[]) => {
    if (!order || !plan || currentRound < 0) return;
    const r = plan.rounds[currentRound];
    const items = order.items.slice(r.start, r.start + r.size);
    let ok = true;
    let reason = t("스캔 순서 일치", "扫描顺序一致");
    for (let i = 0; i < items.length; i++) {
      if (!keysOf(items[i]).includes(norm(codes[i] || ""))) {
        ok = false;
        reason = t(`${i + 1}번째 스캔이 기대 순서와 다릅니다`, `第 ${i + 1} 次扫描与预期顺序不符`);
        break;
      }
    }
    setHistory(prev => [{
      id: `${order.id}-${currentRound}-${Date.now()}`,
      orderId: order.id,
      round: currentRound,
      at: Date.now(),
      expected: items.map(it => it.card_barcode || it.card_serial),
      scanned: codes,
      ok,
      reason,
    }, ...prev].slice(0, 300));
    setScans([]);
  }, [order, plan, currentRound, isKo]);

  const handleScan = (raw: string) => {
    const code = raw.trim();
    setInput("");
    if (!code || !order || currentRound < 0) return;
    const next = [...scans, code];
    if (next.length >= expectedItems.length) finishRound(next);
    else setScans(next);
  };

  const regenerate = () => {
    if (!order) return;
    if (!confirm(t("표본을 다시 추첨하고 이 주문의 검사 이력을 초기화할까요?", "重新抽取样本并清除该订单的检验记录？"))) return;
    setPlans(prev => ({ ...prev, [order.id]: buildPlan(order.id, order.items.length) }));
    setHistory(prev => prev.filter(h => h.orderId !== order.id));
    setScans([]);
  };

  // ─── 주문 목록 ────────────────────────────────────────────────────
  if (!order) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          title={t("카드 DM코드 검사", "卡片DM码检验")}
          description={t("무작위 지점에서 연속 3장씩 스캔해 DM 바코드 순서가 맞는지 확인합니다 (5개 이하 1회 · 10개 이하 2회 · 그 외 3회)", "在随机位置连续扫描3张，确认DM条码顺序 (≤5张1轮 · ≤10张2轮 · 其他3轮)")}
        />
        <div className="flex-1 overflow-auto p-6">
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">{t("주문번호", "订单号")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("트윈커", "Twinker")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("상품", "商品")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("카드 수량", "卡片数量")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("검사 진행", "检验进度")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("납기", "交期")}</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const total = o.items.length;
                  const need = roundsFor(total);
                  const hs = history.filter(h => h.orderId === o.id);
                  const seen = new Map<number, boolean>();
                  for (let i = hs.length - 1; i >= 0; i--) seen.set(hs[i].round, hs[i].ok);
                  const done = seen.size;
                  const failed = [...seen.values()].filter(v => !v).length;
                  return (
                    <tr key={o.id} className="border-t hover:bg-muted/20 cursor-pointer" onClick={() => setSelectedOrderId(o.id)}>
                      <td className="px-4 py-3 font-medium text-primary hover:underline">{o.externalOrderId}</td>
                      <td className="px-4 py-3">{o.twinker}</td>
                      <td className="px-4 py-3">{o.product}</td>
                      <td className="px-4 py-3 tabular-nums">{total}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {t(`${done}/${need} 회차`, `${done}/${need} 轮`)}
                          </span>
                          {done >= need && need > 0 && failed === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">{t("최종 통과", "最终通过")}</span>
                          )}
                          {failed > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">{t(`실패 ${failed}`, `失败 ${failed}`)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{o.dueDate}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline">{t("선택", "选择")}</Button>
                      </td>
                    </tr>
                  );
                })}
                {orders.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{t("주문이 없습니다", "暂无订单")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  const need = plan?.rounds.length ?? 0;
  const doneCount = doneRounds.size;
  const failedCount = [...doneRounds.values()].filter(h => !h.ok).length;
  const finished = need > 0 && doneCount >= need;

  // ─── 검사 화면 ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <PageHeader title={t("카드 DM코드 검사", "卡片DM码检验")} description={`${order.externalOrderId} · ${order.twinker} · ${t(`총 ${order.items.length}장`, `共 ${order.items.length} 张`)}`}>
        <Button variant="outline" size="sm" onClick={() => setSelectedOrderId(null)}>
          <ChevronLeft className="w-4 h-4" /> {t("주문 목록", "订单列表")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setScans([])}>
          <RotateCcw className="w-4 h-4" /> {t("현재 회차 초기화", "重置当前轮")}
        </Button>
        <Button variant="outline" size="sm" onClick={regenerate}>
          <Shuffle className="w-4 h-4" /> {t("표본 재추첨", "重新抽样")}
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* 표본 계획 */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold flex items-center justify-between">
            <span>{t("표본 계획 (무작위 연속 구간)", "抽样计划（随机连续区间）")}</span>
            <span className="text-xs text-muted-foreground">{t(`${doneCount}/${need} 회차 완료`, `已完成 ${doneCount}/${need} 轮`)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3">
            {(plan?.rounds ?? []).map((r, idx) => {
              const res = doneRounds.get(idx);
              const active = idx === currentRound;
              const cls = res
                ? res.ok
                  ? "border-[hsl(var(--success)/0.5)] bg-[hsl(var(--success)/0.08)]"
                  : "border-destructive/50 bg-destructive/10"
                : active
                  ? "border-primary bg-primary/5"
                  : "border-dashed";
              return (
                <div key={idx} className={`rounded-lg border p-3 ${cls}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">{t(`${idx + 1}회차`, `第 ${idx + 1} 轮`)}</span>
                    {res
                      ? res.ok
                        ? <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />
                        : <XCircle className="w-4 h-4 text-destructive" />
                      : <Circle className={`w-4 h-4 ${active ? "text-primary" : "text-muted-foreground opacity-40"}`} />}
                  </div>
                  <div className="text-sm">
                    {t("카드 #", "卡片 #")}
                    {Array.from({ length: r.size }, (_, i) => r.start + i + 1).join(", ")}
                  </div>
                  {res && <div className="text-[11px] mt-1 text-muted-foreground">{res.reason}</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* 스캔 */}
        {finished ? (
          <div className={`rounded-lg border p-4 flex items-center gap-3 ${
            failedCount === 0
              ? "bg-[hsl(var(--success)/0.1)] border-[hsl(var(--success)/0.3)] text-[hsl(var(--success))]"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}>
            {failedCount === 0 ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
            <div>
              <div className="font-semibold">
                {failedCount === 0 ? t("최종 통과 · 순서 이상 없음", "最终通过 · 顺序无异常") : t("최종 실패 · 순서 오류 발생", "最终失败 · 存在顺序错误")}
              </div>
              <div className="text-sm opacity-90">{t(`${need}회차 검사 완료 · 실패 ${failedCount}회`, `已完成 ${need} 轮 · 失败 ${failedCount} 轮`)}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <ScanLine className="w-5 h-5 text-primary" />
              <Input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleScan(input); } }}
                placeholder={t(
                  `${currentRound + 1}회차 · 카드 #${(plan?.rounds[currentRound]?.start ?? 0) + scans.length + 1} DM 바코드를 스캔하세요`,
                  `第 ${currentRound + 1} 轮 · 请扫描卡片 #${(plan?.rounds[currentRound]?.start ?? 0) + scans.length + 1} 的DM条码`
                )}
                className="text-base"
                autoFocus
              />
              <span className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                {scans.length}/{expectedItems.length}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {expectedItems.map((it, i) => {
                const scanned = scans[i];
                const state = scanned ? (keysOf(it).includes(norm(scanned)) ? "ok" : "bad") : "wait";
                const cls = state === "ok"
                  ? "border-[hsl(var(--success)/0.5)] bg-[hsl(var(--success)/0.08)]"
                  : state === "bad" ? "border-destructive/50 bg-destructive/10" : "border-dashed";
                return (
                  <div key={i} className={`rounded-lg border p-3 text-xs ${cls}`}>
                    <div className="font-semibold mb-1">
                      {t(`${i + 1}번째 · 카드 #${(plan?.rounds[currentRound]?.start ?? 0) + i + 1}`, `第 ${i + 1} 个 · 卡片 #${(plan?.rounds[currentRound]?.start ?? 0) + i + 1}`)}
                    </div>
                    <div className="text-muted-foreground">{t("기대", "预期")}: <span className="font-mono break-all">{it.card_barcode || it.card_serial || "-"}</span></div>
                    <div className="text-muted-foreground">{t("스캔", "扫描")}: <span className="font-mono break-all">{scanned ?? "-"}</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 검사 이력 */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 text-sm font-semibold">{t("이 주문 검사 이력", "该订单检验记录")}</div>
          {orderHistory.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("이력이 없습니다", "暂无记录")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-4 py-2 font-medium w-32">{t("시각", "时间")}</th>
                  <th className="text-left px-4 py-2 font-medium w-20">{t("회차", "轮次")}</th>
                  <th className="text-left px-4 py-2 font-medium w-24">{t("결과", "结果")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("기대 순서", "预期顺序")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("스캔 순서", "扫描顺序")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("사유", "原因")}</th>
                </tr>
              </thead>
              <tbody>
                {orderHistory.map(h => (
                  <tr key={h.id} className="border-t">
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">{new Date(h.at).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}</td>
                    <td className="px-4 py-2">{t(`${h.round + 1}회차`, `第 ${h.round + 1} 轮`)}</td>
                    <td className="px-4 py-2">
                      {h.ok ? (
                        <span className="inline-flex items-center gap-1 text-[hsl(var(--success))]"><CheckCircle2 className="w-4 h-4" /> {t("통과", "通过")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="w-4 h-4" /> {t("실패", "失败")}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs break-all">{h.expected.join(" → ")}</td>
                    <td className="px-4 py-2 font-mono text-xs break-all">{h.scanned.join(" → ")}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
