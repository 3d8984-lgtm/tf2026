import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ScanLine, Printer, RotateCcw, CheckCircle2, XCircle, Wifi, WifiOff,
  ChevronLeft, AlertTriangle, Loader2, Play, Pause, SkipForward, FlaskConical,
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

/** 게이트웨이가 기록한 원본 스캔 이력 (GET /api/v1/scan/history) */
type ScanEvent = {
  id: string;
  barcode: string;
  scanned_at: string;
  duration: number | null;
  print_status: "pending" | "printing" | "done" | "failed" | "unknown";
  printed: boolean;
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

type SavedItem = {
  position: number;
  code: string;
  status: string;
  test_mode: boolean;
  printed_at: string | null;
};

export type BarcodeKind = "card" | "tshirt";

export type BarcodePrintWorkspaceProps = {
  kind: BarcodeKind;
  /** 고유번호 접미사 (카드: -4, 티셔츠 스티커: -3) */
  suffix: string;
  titleKo: string;
  titleZh: string;
  listDescKo: string;
  listDescZh: string;
  detailListTitleKo: string;
  detailListTitleZh: string;
};

export default function BarcodePrintWorkspace(props: BarcodePrintWorkspaceProps) {
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
    return <OrderDetail order={selected} onBack={() => setSelected(null)} {...props} />;
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={tr(props.titleKo, props.titleZh)}
        description={tr(props.listDescKo, props.listDescZh)}
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

function OrderDetail({
  order, onBack, kind, suffix, titleKo, titleZh, detailListTitleKo, detailListTitleZh,
}: BarcodePrintWorkspaceProps & { order: OrderRow; onBack: () => void }) {
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
  const [testMode, setTestMode] = useState(false);
  const [saved, setSaved] = useState<Record<number, SavedItem>>({});
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<ScanEvent[]>([]);
  const [printerTestText, setPrinterTestText] = useState("TEST123");
  const [printerTesting, setPrinterTesting] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const lastKeyRef = useRef<string>("");


  // 기대 스캔 순서 = 고유번호(개별 주문번호 + suffix) 순서
  const expected = useMemo(() => {
    const src: any[] = Array.isArray(order.source_data?.items) ? order.source_data.items : [];
    const count = Math.max(src.length, order.quantity ?? 0);
    return Array.from({ length: count }, (_, idx) => {
      const it = src[idx] || {};
      const base = String(it.order_id ?? it.sequence_no ?? `${order.external_order_id}-${idx + 1}`);
      const no = `${base}${suffix}`;
      return {
        position: idx + 1,
        no,
        base,
        keys: [no, base].filter(Boolean).map((v: string) => norm(v)),
      };
    });
  }, [order, suffix]);

  // 서버에 저장된 작업 이력 로드 / 없으면 생성
  const loadSaved = useCallback(async () => {
    if (expected.length === 0) return;
    const { data } = await supabase
      .from("barcode_print_items")
      .select("position, code, status, test_mode, printed_at")
      .eq("kind", kind)
      .eq("order_id", order.id)
      .order("position");

    const rows = (data ?? []) as SavedItem[];
    const existing = new Set(rows.map((r) => r.position));
    const missing = expected
      .filter((e) => !existing.has(e.position))
      .map((e) => ({ kind, order_id: order.id, position: e.position, code: e.no, status: "pending" }));
    if (missing.length > 0) {
      await supabase.from("barcode_print_items").upsert(missing, { onConflict: "kind,order_id,position" });
    }
    const map: Record<number, SavedItem> = {};
    for (const r of rows) map[r.position] = r;
    for (const m of missing) map[m.position] = { position: m.position, code: m.code, status: "pending", test_mode: false, printed_at: null };
    setSaved(map);

    // 진행 위치 복원 = 완료되지 않은 첫 항목
    let c = 0;
    seenRef.current = new Set();
    for (const e of expected) {
      if (map[e.position]?.status === "done") { c = e.position; seenRef.current.add(norm(e.no)); }
      else break;
    }
    setCursor(c);
    setReady(true);
  }, [expected, kind, order.id]);

  useEffect(() => { setReady(false); loadSaved(); }, [loadSaved]);

  const markDone = useCallback(async (position: number, code: string, scannedValue: string | null, isTest: boolean) => {
    const now = new Date().toISOString();
    await supabase.from("barcode_print_items").upsert(
      {
        kind, order_id: order.id, position, code,
        status: "done", verdict: "ok", scanned_value: scannedValue,
        scanned_at: scannedValue ? now : null, printed_at: now, test_mode: isTest,
      },
      { onConflict: "kind,order_id,position" },
    );
    setSaved((prev) => ({ ...prev, [position]: { position, code, status: "done", test_mode: isTest, printed_at: now } }));
  }, [kind, order.id]);

  /**
   * 게이트웨이 프린터 전송.
   * 게이트웨이에는 큐 투입 API가 없고(큐는 스캔 이벤트로만 채워짐),
   * 진단/직접 인쇄용 `POST /api/v1/print/test` 만 제공된다.
   */
  const sendToPrinter = useCallback(async (code: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await proxyFetch("/api/v1/print/test", {
        method: "POST",
        body: JSON.stringify({ text: code.slice(0, 200) }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && j?.accepted) return { ok: true };
      const detail = j?.detail;
      const msg = typeof detail === "string"
        ? detail
        : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(", ") : `HTTP ${res.status}`;
      return { ok: false, error: msg };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, []);


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

  // 새 스캔 감지 → 순서/정보 검증 (테스트 모드에서는 스캔 무시)
  useEffect(() => {
    if (!ready || testMode) return;
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
      void markDone(target.position, target.no, status.last_barcode as string, false);
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
  }, [status, expected, cursor, testMode, ready, markDone]);

  // 전체 초기화 — 서버 기록 삭제
  const resetAll = async () => {
    await proxyFetch("/api/v1/scan/reset", { method: "POST", body: "{}" }).catch(() => null);
    await supabase.from("barcode_print_items").delete().eq("kind", kind).eq("order_id", order.id);
    seenRef.current = new Set();
    setCursor(0);
    setLog([]);
    setLastVerdict(null);
    setHalted(false);
    lastKeyRef.current = "";
    await loadSaved();
    toast.success(tr("작업이 초기화되었습니다", "作业已复位"));
  };

  // 중간부터 다시 작업 — 해당 순번부터 미완료 처리
  const resumeFrom = async (position: number) => {
    await supabase
      .from("barcode_print_items")
      .update({ status: "pending", verdict: null, scanned_value: null, scanned_at: null, printed_at: null })
      .eq("kind", kind).eq("order_id", order.id).gte("position", position);
    setHalted(false);
    setLastVerdict(null);
    lastKeyRef.current = "";
    await loadSaved();
    toast.success(tr(`${position}번부터 다시 작업합니다`, `从第 ${position} 项重新作业`));
  };

  // 개별 재작업(스캔 없이 즉시 인쇄)
  const reprint = async (position: number, code: string) => {
    const r = await sendToPrinter(code);
    await markDone(position, code, null, testMode);
    toast[r.ok ? "success" : "error"](
      r.ok ? tr("인쇄 요청을 보냈습니다", "已发送打印请求")
           : `${tr("인쇄 전송 실패", "打印发送失败")} — ${r.error ?? ""}`,
    );
  };

  // 테스트 모드 순차 인쇄
  const printNextTest = async () => {
    const target = expected[cursor];
    if (!target) return;
    const r = await sendToPrinter(target.no);
    await markDone(target.position, target.no, null, true);
    setCursor((c) => c + 1);
    seenRef.current.add(norm(target.no));
    toast[r.ok ? "success" : "error"](
      r.ok ? `${target.no} ${tr("인쇄 요청", "打印请求")}`
           : `${tr("인쇄 전송 실패", "打印发送失败")} — ${r.error ?? ""}`,
    );
  };

  // 프린터 연결 진단 (임의 텍스트 즉시 전송)
  const runPrinterTest = async () => {
    const text = (printerTestText || "TEST123").slice(0, 200);
    setPrinterTesting(true);
    const r = await sendToPrinter(text);
    setPrinterTesting(false);
    toast[r.ok ? "success" : "error"](
      r.ok ? `${tr("프린터로 전송했습니다", "已发送到打印机")} · ${text}`
           : `${tr("프린터 전송 실패", "打印机发送失败")} — ${r.error ?? ""}`,
    );
  };


  const total = expected.length;
  const doneCount = Object.values(saved).filter((s) => s.status === "done").length;
  const progress = total ? Math.min(100, (doneCount / total) * 100) : 0;
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
        title={`${tr(titleKo, titleZh)} · ${order.external_order_id}`}
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
                {doneCount}<span className="text-base text-muted-foreground"> / {total || "-"}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">{tr("작업 완료 (서버 저장)", "已完成（服务器保存）")}</p>
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
              {testMode ? (
                <Badge variant="outline" className="gap-1 justify-center border-amber-500/50 text-amber-600 dark:text-amber-400">
                  <FlaskConical className="w-3 h-3" />{tr("테스트 모드", "测试模式")}
                </Badge>
              ) : offline || !status?.connected ? (
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

        {/* 테스트 모드 토글 */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Switch id="bp-test-mode" checked={testMode} onCheckedChange={setTestMode} />
              <Label htmlFor="bp-test-mode" className="cursor-pointer">
                <span className="font-medium">{tr("테스트 모드", "测试模式")}</span>
                <span className="block text-xs text-muted-foreground">
                  {tr("스캔 검증을 사용하지 않고 주문 상세 목록 순서대로 인쇄만 진행합니다",
                      "不进行扫描检验，按订单明细顺序仅执行打印")}
                </span>
              </Label>
            </div>
            {testMode && (
              <Button size="sm" className="gap-1" onClick={printNextTest} disabled={cursor >= total}>
                <Printer className="w-4 h-4" />
                {cursor >= total
                  ? tr("모두 인쇄됨", "全部已打印")
                  : `${tr("다음 인쇄", "打印下一个")} · ${expected[cursor]?.no ?? ""}`}
              </Button>
            )}
          </CardContent>
        </Card>

        {halted && !testMode && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {tr("검증 실패 — 인쇄가 중지되었습니다. 순서를 확인한 뒤 재개하세요.", "检验失败 — 打印已停止。请确认顺序后恢复。")}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 주문 상세 목록 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ScanLine className="w-4 h-4" />{tr(detailListTitleKo, detailListTitleZh)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-2 rounded bg-muted overflow-hidden mb-3">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="max-h-[420px] overflow-auto divide-y">
                {expected.map((e, i) => {
                  const rec = saved[e.position];
                  const done = rec?.status === "done";
                  const current = i === cursor;
                  return (
                    <div key={i} className={`flex items-center gap-2 py-2.5 px-2 text-sm ${current ? "bg-primary/10 rounded" : ""}`}>
                      <span className="w-7 tabular-nums text-muted-foreground">{e.position}</span>
                      <span className="flex-1 font-mono text-xs break-all">{e.no}</span>
                      {done ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        : current ? <Badge variant="outline" className="shrink-0 text-[10px]">{tr("대기", "等待")}</Badge>
                        : <span className="w-4" />}
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs shrink-0"
                        onClick={() => resumeFrom(e.position)}
                        title={tr("이 순번부터 다시 작업", "从此项重新作业")}
                      >
                        <SkipForward className="w-3.5 h-3.5" />{tr("여기부터", "从此")}
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs shrink-0"
                        onClick={() => reprint(e.position, e.no)}
                        title={tr("스캔 없이 이 항목만 인쇄", "不扫描仅打印此项")}
                      >
                        <Printer className="w-3.5 h-3.5" />{tr("재인쇄", "重印")}
                      </Button>
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
