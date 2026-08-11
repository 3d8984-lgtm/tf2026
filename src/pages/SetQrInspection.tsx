import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { scanSuccess, scanFail } from "@/lib/scan-sound";
import {
  ChevronLeft, ScanLine, CheckCircle2, XCircle, RotateCcw, Loader2, AlertTriangle, CreditCard, Shirt,
} from "lucide-react";

const norm = (v: string) => (v || "").trim().toUpperCase();
/** 고유번호에서 접미사(-3, -4 등)를 제거한 개별 주문번호 */
const baseOf = (v: string) => norm(v).replace(/-\d+$/, "");

const STORAGE_KEY = "set-qr-inspection.v1";

type OrderRow = {
  id: string;
  external_order_id: string;
  product_code: string;
  design_code: string | null;
  quantity: number;
  recipient_name: string;
  project_completed_at: string | null;
  created_at: string;
  source_data: any;
};

type PairResult = { ok: boolean; card: string; tshirt: string; at: string; reason: string };
type Store = Record<string, Record<number, PairResult>>; // orderId → position → result

function loadStore(): Store {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveStore(s: Store) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export default function SetQrInspection() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [store, setStore] = useState<Store>(() => loadStore());

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, external_order_id, product_code, design_code, quantity, recipient_name, project_completed_at, created_at, source_data")
        .order("created_at", { ascending: false })
        .limit(200);
      setOrders((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  const update = useCallback((orderId: string, next: Record<number, PairResult>) => {
    setStore((prev) => {
      const merged = { ...prev, [orderId]: next };
      saveStore(merged);
      return merged;
    });
  }, []);

  if (selected) {
    return (
      <SetInspectDetail
        order={selected}
        results={store[selected.id] ?? {}}
        onChange={(next) => update(selected.id, next)}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={tr("세트포장 큐알코드 검사", "套装包装QR码检验")}
        description={tr("주문을 선택한 후 카드 포장 QR과 티셔츠 포장 QR을 스캔해 동일 상품 여부를 검증합니다", "选择订单后扫描卡片包装QR与T恤包装QR，验证是否为同一商品")}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : orders.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-16">{tr("주문 데이터가 없습니다", "暂无订单数据")}</p>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">{tr("작업지시번호", "工单号")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("트윈커", "Twinker")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("상품", "商品")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("수량", "数量")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("검사 진행", "检验进度")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("납기일", "交期")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const res = store[o.id] ?? {};
                  const values = Object.values(res);
                  const pass = values.filter((r) => r.ok).length;
                  const fail = values.filter((r) => !r.ok).length;
                  const total = Math.max(Array.isArray(o.source_data?.items) ? o.source_data.items.length : 0, o.quantity ?? 0);
                  const pct = total > 0 ? Math.round((values.length / total) * 100) : 0;
                  return (
                    <tr key={o.id} className="border-t hover:bg-muted/20 cursor-pointer" onClick={() => setSelected(o)}>
                      <td className="px-4 py-3 font-mono font-medium text-primary hover:underline">{o.external_order_id}</td>
                      <td className="px-4 py-3">{o.recipient_name}</td>
                      <td className="px-4 py-3">{o.product_code}</td>
                      <td className="px-4 py-3 tabular-nums">{total}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{values.length}/{total}</span>
                          {pass > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">✓{pass}</span>}
                          {fail > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">!{fail}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {o.project_completed_at ? new Date(o.project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN") : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline">{tr("선택", "选择")}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SetInspectDetail({
  order, results, onChange, onBack,
}: {
  order: OrderRow;
  results: Record<number, PairResult>;
  onChange: (next: Record<number, PairResult>) => void;
  onBack: () => void;
}) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const items = useMemo(() => {
    const src: any[] = Array.isArray(order.source_data?.items) ? order.source_data.items : [];
    const count = Math.max(src.length, order.quantity ?? 0);
    return Array.from({ length: count }, (_, idx) => {
      const it = src[idx] || {};
      const base = norm(String(it.order_id ?? it.sequence_no ?? `${order.external_order_id}-${idx + 1}`));
      return {
        position: idx + 1,
        base,
        cardCode: `${base}-4`,
        tshirtCode: `${base}-3`,
        color: it.tshirt_color ?? "",
        size: it.tshirt_size ?? "",
      };
    });
  }, [order]);

  const [cardScan, setCardScan] = useState("");
  const [tshirtScan, setTshirtScan] = useState("");
  const [verdict, setVerdict] = useState<PairResult | null>(null);
  const [halted, setHalted] = useState(false);
  const cardRef = useRef<HTMLInputElement>(null);
  const tshirtRef = useRef<HTMLInputElement>(null);

  // 다음 검사 대상(미검사 또는 실패한 첫 항목)
  const activePos = useMemo(() => {
    const next = items.find((i) => !results[i.position]?.ok);
    return next?.position ?? null;
  }, [items, results]);
  const activeItem = items.find((i) => i.position === activePos) ?? null;

  useEffect(() => { cardRef.current?.focus(); }, []);

  const clearInputs = () => {
    setCardScan("");
    setTshirtScan("");
    pendingCardRef.current = "";
    bufferRef.current = "";
    setTimeout(() => cardRef.current?.focus(), 30);
  };


  const evaluate = (card: string, tshirt: string) => {
    const cardBase = baseOf(card);
    const tshirtBase = baseOf(tshirt);
    const match = items.find((i) => i.base === cardBase);

    let ok = false;
    let reason: string;
    if (!cardBase || !tshirtBase) {
      reason = tr("스캔 값이 비어 있습니다", "扫描值为空");
    } else if (cardBase !== tshirtBase) {
      reason = tr("카드와 티셔츠가 다른 상품입니다", "卡片与T恤为不同商品");
    } else if (!match) {
      reason = tr("이 주문에 없는 상품입니다", "该商品不属于此订单");
    } else if (activeItem && match.position !== activeItem.position) {
      reason = tr(`작업 순서가 다릅니다 (현재 ${activeItem.position}번)`, `作业顺序不符（当前第${activeItem.position}项）`);
    } else {
      ok = true;
      reason = tr("동일 상품 확인 — 통과", "同一商品确认 — 通过");
    }

    const result: PairResult = { ok, card: norm(card), tshirt: norm(tshirt), at: new Date().toISOString(), reason };
    setVerdict(result);

    const position = match?.position ?? activeItem?.position ?? (Object.keys(results).length + 1) * -1;
    onChange({ ...results, [position]: result });

    if (ok) {
      scanSuccess();
      toast.success(`${tr("통과", "通过")} · #${position}`);
      setHalted(false);
    } else {
      scanFail();
      toast.error(reason);
      setHalted(true);
    }
    clearInputs();
  };

  // 스캐너 자동 입력: 카드 포장 QR → 티셔츠 포장 QR 순차 입력 후 자동 검증
  const bufferRef = useRef("");
  const lastKeyRef = useRef(0);
  const pendingCardRef = useRef("");
  const stateRef = useRef({ cardScan, halted, activePos, evaluate });
  stateRef.current = { cardScan, halted, activePos, evaluate };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // 두 스캔 입력창 또는 다른 입력 요소에 포커스가 있으면 해당 입력창의 자체 로직에 맡김
      if (el && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;

      const { halted: isHalted, activePos: pos } = stateRef.current;
      if (isHalted || pos == null) return;

      const now = Date.now();
      if (now - lastKeyRef.current > 1000) bufferRef.current = "";
      lastKeyRef.current = now;

      if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        e.stopPropagation();
        const value = bufferRef.current.trim();
        bufferRef.current = "";
        if (!value) return;
        if (!pendingCardRef.current) {
          // 1차 스캔 = 카드 포장 QR (검증하지 않고 대기)
          pendingCardRef.current = value;
          setCardScan(value);
          setTshirtScan("");
          setTimeout(() => tshirtRef.current?.focus(), 20);
        } else {
          // 2차 스캔 = 티셔츠 포장 QR → 두 값이 모두 있을 때만 검증
          const card = pendingCardRef.current;
          pendingCardRef.current = "";
          setTshirtScan(value);
          stateRef.current.evaluate(card, value);
        }
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        bufferRef.current = bufferRef.current.slice(0, -1);
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        bufferRef.current += e.key;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);


  const values = Object.values(results);
  const pass = values.filter((r) => r.ok).length;
  const fail = values.filter((r) => !r.ok).length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={tr("세트포장 큐알코드 검사", "套装包装QR码检验")}
        description={`${order.external_order_id} · ${order.recipient_name}`}
      >
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" /> {tr("주문 목록", "订单列表")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { onChange({}); setVerdict(null); setHalted(false); clearInputs(); toast.success(tr("검사 기록이 초기화되었습니다", "检验记录已复位")); }}
        >
          <RotateCcw className="w-4 h-4" /> {tr("초기화", "重置")}
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {/* 판정 배너 */}
        <div
          className={`rounded-lg border p-5 flex items-center gap-4 ${
            verdict == null
              ? "bg-muted/30"
              : verdict.ok
                ? "border-[hsl(var(--success))] bg-[hsl(var(--success)/0.12)]"
                : "border-destructive bg-destructive/10"
          }`}
        >
          {verdict == null ? <ScanLine className="w-8 h-8 text-muted-foreground" />
            : verdict.ok ? <CheckCircle2 className="w-8 h-8 text-[hsl(var(--success))]" />
              : <AlertTriangle className="w-8 h-8 text-destructive animate-pulse" />}
          <div className="flex-1">
            <p className="text-lg font-semibold">
              {verdict == null ? tr("스캔 대기", "等待扫描") : verdict.ok ? tr("검증 통과 (O)", "验证通过 (O)") : tr("검증 실패 (X)", "验证失败 (X)")}
            </p>
            <p className="text-sm text-muted-foreground">{verdict?.reason ?? tr("카드 포장 QR → 티셔츠 포장 QR 순으로 스캔하세요", "请按 卡片包装QR → T恤包装QR 顺序扫描")}</p>
          </div>
          {activeItem ? (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{tr("현재 작업건", "当前作业")}</p>
              <p className="text-xl font-bold tabular-nums">#{activeItem.position}</p>
              <p className="text-xs font-mono text-muted-foreground">{activeItem.base}</p>
            </div>
          ) : (
            <Badge className="bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">{tr("전체 완료", "全部完成")}</Badge>
          )}
        </div>

        {halted && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <p className="text-sm flex-1">
              {tr("검증 실패 — 작업이 중지되었습니다. 확인 후 계속을 누르세요.", "验证失败 — 作业已停止。确认后请点击继续。")}
            </p>
            <Button size="sm" variant="destructive" onClick={() => { setHalted(false); setVerdict(null); clearInputs(); }}>
              {tr("확인 후 계속", "确认后继续")}
            </Button>
          </div>
        )}

        {/* 스캔 입력 */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className={`rounded-lg border bg-card p-4 space-y-2 ${!halted && !cardScan.trim() ? "ring-2 ring-primary" : ""}`}>
            <p className="text-sm font-medium flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> {tr("카드 포장 QR", "卡片包装QR")}</p>
            <Input
              ref={cardRef}
              value={cardScan}
              onChange={(e) => setCardScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (cardScan.trim()) tshirtRef.current?.focus();
                }
              }}
              placeholder={tr("카드 포장 QR 스캔", "扫描卡片包装QR")}
              className="font-mono"
            />
          </div>
          <div className={`rounded-lg border bg-card p-4 space-y-2 ${!halted && cardScan.trim() ? "ring-2 ring-primary" : ""}`}>
            <p className="text-sm font-medium flex items-center gap-2"><Shirt className="w-4 h-4 text-primary" /> {tr("티셔츠 포장 QR", "T恤包装QR")}</p>
            <Input
              ref={tshirtRef}
              value={tshirtScan}
              onChange={(e) => setTshirtScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (cardScan.trim() && tshirtScan.trim()) evaluate(cardScan, tshirtScan);
                }
              }}
              placeholder={tr("티셔츠 포장 QR 스캔", "扫描T恤包装QR")}
              className="font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => evaluate(cardScan, tshirtScan)} disabled={halted || !cardScan.trim() || !tshirtScan.trim()}>
            <ScanLine className="w-4 h-4" /> {tr("검사", "检验")}
          </Button>
          <Button variant="outline" onClick={clearInputs}>{tr("입력 지우기", "清除输入")}</Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {tr(`통과 ${pass} · 실패 ${fail} / 총 ${items.length}`, `通过 ${pass} · 失败 ${fail} / 共 ${items.length}`)}
          </span>
        </div>


        {/* 주문 상세 목록 */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold">
            {tr("주문 상세 목록", "订单明细")}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">{tr("카드 포장 QR", "卡片包装QR")}</th>
                <th className="text-left px-4 py-2 font-medium">{tr("티셔츠 포장 QR", "T恤包装QR")}</th>
                <th className="text-left px-4 py-2 font-medium">{tr("색상/사이즈", "颜色/尺码")}</th>
                <th className="text-left px-4 py-2 font-medium">{tr("결과", "结果")}</th>
                <th className="text-left px-4 py-2 font-medium">{tr("검사 시각", "检验时间")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const r = results[it.position];
                return (
                  <tr key={it.position} className={`border-t ${it.position === activePos ? "bg-primary/10" : r ? (r.ok ? "" : "bg-destructive/5") : ""}`}>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">{it.position}</td>
                    <td className="px-4 py-2 font-mono text-xs">{it.cardCode}</td>
                    <td className="px-4 py-2 font-mono text-xs">{it.tshirtCode}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{[it.color, it.size].filter(Boolean).join(" / ") || "-"}</td>
                    <td className="px-4 py-2">
                      {r ? (
                        r.ok
                          ? <Badge className="bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.15)]"><CheckCircle2 className="w-3 h-3 mr-1" />{tr("통과", "通过")}</Badge>
                          : <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />{tr("실패", "失败")}</Badge>
                      ) : (
                        <Badge variant="outline">{tr("대기", "等待")}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                      {r ? new Date(r.at).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN") : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
