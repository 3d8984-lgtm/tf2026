import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ScanLine, Printer, RotateCcw, CheckCircle2, XCircle, Wifi, WifiOff,
  ChevronLeft, AlertTriangle, Loader2, Play, Pause,
} from "lucide-react";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function proxyFetch(path: string, init?: RequestInit) {
  return fetch(`${PROXY_BASE}${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
}

const norm = (v: string) => (v || "").trim().toUpperCase();

type ScanStatus = {
  count: number;
  last_barcode: string | null;
  last_duration: number | null;
  last_seen: string | null;
  connected: boolean;
};

type PrintJob = {
  id: string;
  barcode: string;
  status: "pending" | "printing" | "done" | "failed";
  enqueued_at: string;
  printed_at: string | null;
  error: string | null;
};

type Verdict = "ok" | "order" | "mismatch" | "duplicate";

type LogRow = {
  at: string;
  barcode: string;
  verdict: Verdict;
  expected: string | null;
  position: number | null;
};

type OrderRow = {
  id: string;
  external_order_id: string;
  product_code: string;
  design_code: string | null;
  quantity: number;
  recipient_name: string;
  created_at: string;
  source_data: any;
};

export default function CardBarcodePrint() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OrderRow | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, external_order_id, product_code, design_code, quantity, recipient_name, created_at, source_data")
        .order("created_at", { ascending: false })
        .limit(200);
      setOrders((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  if (selected) {
    return <OrderDetail order={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={tr("카드 바코드 인쇄 작업", "卡片条码打印作业")}
        description={tr("주문건을 선택하면 스캔 검증 및 인쇄 모니터링 화면으로 이동합니다", "选择订单后进入扫描检验与打印监控界面")}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : orders.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-16">{tr("주문 데이터가 없습니다", "暂无订单数据")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelected(o)}
                className="text-left rounded-lg border bg-card p-4 hover:border-primary hover:bg-accent/40 transition-colors active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm font-medium break-all">{o.external_order_id}</span>
                  <Badge variant="outline" className="shrink-0 tabular-nums">{o.quantity}{tr("장", "张")}</Badge>
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p>{tr("상품코드", "商品代码")} · {o.product_code}</p>
                  <p>{tr("트윈커", "收件人")} · {o.recipient_name}</p>
                  <p className="tabular-nums">{new Date(o.created_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN")}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OrderDetail({ order, onBack }: { order: OrderRow; onBack: () => void }) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [log, setLog] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [lastVerdict, setLastVerdict] = useState<Verdict | null>(null);
  const [halted, setHalted] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const lastKeyRef = useRef<string>("");

  // 기대 스캔 순서 = 카드 고유번호(개별 주문번호-4) 순서
  const expected = useMemo(() => {
    const src: any[] = Array.isArray(order.source_data?.items) ? order.source_data.items : [];
    const count = Math.max(src.length, order.quantity ?? 0);
    return Array.from({ length: count }, (_, idx) => {
      const it = src[idx] || {};
      const base = String(
        it.order_id ?? it.sequence_no ?? `${order.external_order_id}-${idx + 1}`
      );
      const cardNo = `${base}-4`;
      return {
        position: idx + 1,
        no: cardNo,
        base,
        keys: [cardNo, base].filter(Boolean).map((v: string) => norm(v)),
      };
    });
  }, [order]);

  // 스캐너 상태 + 인쇄 대기열 폴링
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [sRes, pRes] = await Promise.all([
          proxyFetch("/api/v1/scan/status"),
          proxyFetch("/api/v1/print/queue"),
        ]);
        const s: any = await sRes.json();
        if (!alive) return;
        if (!sRes.ok || "upstream_status" in s) { setOffline(true); }
        else { setOffline(false); setStatus(s as ScanStatus); }
        if (pRes.ok) {
          const p: any = await pRes.json();
          if (Array.isArray(p?.jobs)) { setJobs(p.jobs.slice(-50).reverse()); setPendingCount(p.pending_count ?? 0); }
        }
      } catch {
        if (alive) setOffline(true);
      }
    };
    tick();
    const iv = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 새 스캔 감지 → 순서/정보 검증
  useEffect(() => {
    if (!status?.last_barcode) return;
    const key = `${status.last_seen ?? ""}|${status.last_barcode}|${status.count}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    const code = norm(status.last_barcode);
    let verdict: Verdict = "mismatch";
    let position: number | null = null;
    const target = expected[cursor];

    if (seenRef.current.has(code)) {
      verdict = "duplicate";
      position = expected.findIndex((e) => e.keys.includes(code)) + 1 || null;
    } else if (target && target.keys.includes(code)) {
      verdict = "ok";
      position = target.position;
      seenRef.current.add(code);
      setCursor((c) => c + 1);
    } else {
      const found = expected.findIndex((e) => e.keys.includes(code));
      if (found >= 0) { verdict = "order"; position = found + 1; }
    }

    setLastVerdict(verdict);
    if (verdict !== "ok") setHalted(true);
    setLog((prev) => [
      { at: status.last_seen ?? new Date().toISOString(), barcode: status.last_barcode as string, verdict, expected: target?.no ?? null, position },
      ...prev,
    ].slice(0, 100));
  }, [status, expected, cursor]);

  const resetAll = async () => {
    await proxyFetch("/api/v1/scan/reset", { method: "POST", body: "{}" }).catch(() => null);
    seenRef.current = new Set();
    setCursor(0);
    setLog([]);
    setLastVerdict(null);
    setHalted(false);
    lastKeyRef.current = "";
  };

  const total = expected.length;
  const progress = total ? Math.min(100, (cursor / total) * 100) : 0;
  const verdictMeta: Record<Verdict, { ko: string; zh: string; cls: string }> = {
    ok: { ko: "일치", zh: "匹配", cls: "text-emerald-500" },
    order: { ko: "순서 오류", zh: "顺序错误", cls: "text-destructive" },
    mismatch: { ko: "정보 불일치", zh: "信息不匹配", cls: "text-destructive" },
    duplicate: { ko: "중복 스캔", zh: "重复扫描", cls: "text-destructive" },
  };
  const jobMeta: Record<string, { ko: string; zh: string; cls: string }> = {
    pending: { ko: "대기", zh: "等待", cls: "text-muted-foreground" },
    printing: { ko: "전송 중", zh: "发送中", cls: "text-primary" },
    done: { ko: "완료", zh: "完成", cls: "text-emerald-500" },
    failed: { ko: "실패", zh: "失败", cls: "text-destructive" },
  };

  const lampOk = !halted && lastVerdict === "ok";
  const lampBad = halted;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`${tr("카드 바코드 인쇄", "卡片条码打印")} · ${order.external_order_id}`}
        description={`${tr("상품", "商品")} ${order.product_code} · ${tr("수량", "数量")} ${order.quantity}`}
      >
        <Button variant="outline" size="sm" className="gap-1" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" />{tr("주문 목록", "订单列表")}
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {/* 상단 상태 바 */}
        <Card className={halted ? "border-destructive" : ""}>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-5 gap-4 items-center">
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-2">
                <span className={`w-10 h-10 rounded-full border transition-all ${lampOk ? "bg-emerald-500 shadow-[0_0_20px_hsl(var(--primary)/0.6)]" : "bg-muted"}`} />
                <span className={`w-10 h-10 rounded-full border transition-all ${lampBad ? "bg-destructive shadow-[0_0_20px_hsl(var(--destructive)/0.6)] animate-pulse" : "bg-muted"}`} />
              </div>
              <p className="text-[11px] text-muted-foreground">{tr("경보등", "警示灯")}</p>
            </div>
            <div>
              <p className="text-3xl font-semibold tabular-nums">
                {cursor}<span className="text-base text-muted-foreground"> / {total || "-"}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">{tr("검증 통과", "检验通过")}</p>
            </div>
            <div>
              <p className="text-3xl font-semibold tabular-nums">{pendingCount}</p>
              <p className="text-[11px] text-muted-foreground">{tr("인쇄 대기", "打印等待")}</p>
            </div>
            <div>
              <p className="text-sm font-mono break-all">{status?.last_barcode ?? "-"}</p>
              <p className="text-[11px] text-muted-foreground">{tr("최근 스캔 값", "最近扫描值")}</p>
            </div>
            <div className="flex flex-col gap-2">
              {offline || !status?.connected ? (
                <Badge variant="outline" className="gap-1 text-destructive border-destructive/40 justify-center">
                  <WifiOff className="w-3 h-3" />{tr("스캐너 연결 끊김", "扫描仪断开")}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40 justify-center">
                  <Wifi className="w-3 h-3" />{tr("스캐너 연결됨", "扫描仪已连接")}
                </Badge>
              )}
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="flex-1 gap-1 h-9" onClick={resetAll}>
                  <RotateCcw className="w-3.5 h-3.5" />{tr("초기화", "复位")}
                </Button>
                {halted ? (
                  <Button size="sm" className="flex-1 gap-1 h-9" onClick={() => setHalted(false)}>
                    <Play className="w-3.5 h-3.5" />{tr("재개", "恢复")}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="flex-1 gap-1 h-9" onClick={() => setHalted(true)}>
                    <Pause className="w-3.5 h-3.5" />{tr("중지", "停止")}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {halted && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {tr("검증 실패 — 인쇄가 중지되었습니다. 카드 순서를 확인한 뒤 재개하세요.", "检验失败 — 打印已停止。请确认卡片顺序后恢复。")}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 주문 상세 목록 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ScanLine className="w-4 h-4" />{tr("주문 상세 목록 · 카드 고유번호 (스캔 순서)", "订单明细 · 卡片唯一编号（扫描顺序）")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-2 rounded bg-muted overflow-hidden mb-3">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="max-h-[420px] overflow-auto divide-y">
                {expected.map((e, i) => {
                  const done = i < cursor;
                  const current = i === cursor;
                  return (
                    <div key={i} className={`flex items-center gap-3 py-2.5 px-2 text-sm ${current ? "bg-primary/10 rounded" : ""}`}>
                      <span className="w-8 tabular-nums text-muted-foreground">{e.position}</span>
                      <span className="flex-1 font-mono text-xs break-all">{e.no}</span>
                      {done ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        : current ? <Badge variant="outline" className="shrink-0 text-[10px]">{tr("대기", "等待")}</Badge>
                        : <span className="w-4" />}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 인쇄 대기열 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Printer className="w-4 h-4" />{tr("인쇄 대기열", "打印队列")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-2 py-1.5">{tr("바코드", "条码")}</th>
                      <th className="px-2 py-1.5">{tr("상태", "状态")}</th>
                      <th className="px-2 py-1.5">{tr("시각", "时间")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.length === 0 ? (
                      <tr><td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">{tr("인쇄 작업이 없습니다", "暂无打印作业")}</td></tr>
                    ) : jobs.map((j) => (
                      <tr key={j.id} className={`border-t ${j.status === "failed" ? "bg-destructive/5" : ""}`}>
                        <td className="px-2 py-1.5 font-mono break-all">{j.barcode}</td>
                        <td className={`px-2 py-1.5 font-medium ${jobMeta[j.status]?.cls ?? ""}`}>
                          {isKo ? jobMeta[j.status]?.ko : jobMeta[j.status]?.zh}
                          {j.error && <span className="block text-[10px] text-muted-foreground break-all">{j.error}</span>}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {new Date(j.printed_at ?? j.enqueued_at).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 스캔 검증 로그 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tr("스캔 검증 로그", "扫描检验日志")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-2 py-1.5">{tr("시간", "时间")}</th>
                    <th className="px-2 py-1.5">{tr("스캔 값", "扫描值")}</th>
                    <th className="px-2 py-1.5">{tr("순번", "序号")}</th>
                    <th className="px-2 py-1.5">{tr("기대 값", "期望值")}</th>
                    <th className="px-2 py-1.5">{tr("판정", "判定")}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.length === 0 ? (
                    <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">{tr("스캔 데이터가 없습니다", "暂无扫描数据")}</td></tr>
                  ) : log.map((r, i) => (
                    <tr key={i} className={`border-t ${r.verdict === "ok" ? "" : "bg-destructive/5"}`}>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{new Date(r.at).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}</td>
                      <td className="px-2 py-1.5 font-mono break-all">{r.barcode}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.position ?? "-"}</td>
                      <td className="px-2 py-1.5 font-mono break-all">{r.expected ?? "-"}</td>
                      <td className={`px-2 py-1.5 font-medium ${verdictMeta[r.verdict].cls}`}>
                        <span className="inline-flex items-center gap-1">
                          {r.verdict === "ok" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {isKo ? verdictMeta[r.verdict].ko : verdictMeta[r.verdict].zh}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
