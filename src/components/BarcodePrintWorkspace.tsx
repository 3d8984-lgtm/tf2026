import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { warnLightError, warnLightOkFlash } from "@/lib/warning-light";
import { pfPrint, pfPrinterStatus, pfPrinterQueue, pfPrinterQueueClear } from "@/lib/pf-printer";
import { verifyScanBatch, selectWaitingJobs, mergePrintedAcc, resolvePrintedAt } from "@/lib/barcode-print-logic";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ScanLine, Printer, RotateCcw, CheckCircle2, XCircle, Wifi, WifiOff,
  ChevronLeft, AlertTriangle, Loader2, Play, Pause, SkipForward, FlaskConical, Eraser,
} from "lucide-react";

import PfPrinterCard from "@/components/PfPrinterCard";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function proxyFetch(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  return fetch(`${PROXY_BASE}${path}`, {
    ...init,
    signal: init?.signal ?? controller.signal,
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(init?.headers || {}) },
  }).finally(() => window.clearTimeout(timeout));
}

const norm = (v: string) => (v || "").trim().toUpperCase();
/** 게이트웨이/DB 타임스탬프 포맷이 달라도 안전하게 비교하기 위해 epoch(ms)로 변환 */
const ts = (v?: string | null) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

export type ExpectedItem = {
  position: number;
  no: string;
  base: string;
  cardNo: string | null;
  keys: string[];
};

/** 주문의 기대 스캔 순서(고유번호) 목록을 만든다. 목록 화면의 자동 주문 탐색에도 사용. */
export function buildExpected(
  order: { external_order_id: string; quantity: number; source_data: any },
  suffix: string,
): ExpectedItem[] {
  const src: any[] = Array.isArray(order.source_data?.items) ? order.source_data.items : [];
  const count = Math.max(src.length, order.quantity ?? 0);
  return Array.from({ length: count }, (_, idx) => {
    const it = src[idx] || {};
    const base = String(it.order_id ?? it.sequence_no ?? `${order.external_order_id}-${idx + 1}`);
    const no = `${base}${suffix}`;
    // 카드 고유번호 = NFC-0141-000054 형태만 추출 (NDEF 전체 문자열은 인쇄하지 않음)
    const ndef = String(it.nfc_ndef_data ?? "");
    const pickCardNo = (raw: unknown): string => {
      const s = String(raw ?? "").trim();
      if (!s) return "";
      const m = s.match(/NFC-[A-Za-z0-9]+-[A-Za-z0-9]+/i);
      if (m) return m[0];
      if (s.includes("|")) return (s.split("|")[1] ?? "").trim();
      return s;
    };
    const cardNo =
      pickCardNo(it.card_no) ||
      pickCardNo(it.card_unique_no) ||
      pickCardNo(it.unique_no) ||
      pickCardNo(ndef);

    return {
      position: idx + 1,
      no,
      base,
      cardNo: cardNo || null,
      keys: [no, base, cardNo].filter(Boolean).map((v: string) => norm(v)),
    };
  });
}

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
  /** kind=print & done일 때만 값 존재. true = 프린터 인쇄완료(0x40) 확인됨 */
  printed: boolean | null;
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

/** 프린터로 실제 전송한 원본 명령/응답 기록 (화면 로컬) */
type PrinterSendLog = {
  id: string;
  at: string;
  code: string;
  payload: string;
  ok: boolean;
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

  // ── 스캔 값으로 주문 자동 탐색 ────────────────────────────────────
  // 주문을 고르지 않은 상태에서 바코드를 스캔하면, 그 값이 포함된 주문건을 찾아 자동으로 연다.
  const ordersRef = useRef<OrderRow[]>([]);
  ordersRef.current = orders;
  const suffix = props.suffix;
  useEffect(() => {
    if (selected || orders.length === 0) return;
    let alive = true;
    let lastKey = "";
    let primed = false;
    const tick = async () => {
      try {
        const r = await proxyFetch("/api/v1/scan/status");
        const j: any = await r.json();
        if (!alive || !r.ok || !j?.last_barcode) return;
        const key = `${j.last_seen ?? ""}|${j.last_barcode}`;
        if (!primed) { primed = true; lastKey = key; return; } // 진입 시 기존 값은 무시
        if (key === lastKey) return;
        lastKey = key;
        const code = norm(String(j.last_barcode));
        const hit = ordersRef.current.find((o) => buildExpected(o, suffix).some((e) => e.keys.includes(code)));
        if (hit) {
          toast.success(`${tr("주문 자동 선택", "自动选择订单")} · ${hit.external_order_id}`);
          setSelected(hit);
        } else {
          toast.error(`${tr("해당 값이 포함된 주문을 찾을 수 없습니다", "未找到包含该值的订单")} · ${j.last_barcode}`);
        }
      } catch { /* 네트워크 오류는 무시 */ }
    };
    const iv = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(iv); };
  }, [selected, orders.length, suffix, isKo]);

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
  const [printerOffline, setPrinterOffline] = useState(false);
  // 최초 폴링 응답 전에는 연결 여부를 알 수 없다 → "확인 중" 으로 표시(끊김으로 깜빡이지 않도록)
  const [probed, setProbed] = useState(false);

  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [log, setLog] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [lastVerdict, setLastVerdict] = useState<Verdict | null>(null);
  const [halted, setHalted] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [saved, setSaved] = useState<Record<number, SavedItem>>({});
  const savedRef = useRef<Record<number, SavedItem>>({});
  savedRef.current = saved;
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<ScanEvent[]>([]);
  const [printerLog, setPrinterLog] = useState<PrinterSendLog[]>([]);
  const [rawTab, setRawTab] = useState<"scanner" | "printer" | "dispatch">("scanner");
  /** 디스패치 추적 로그 (밀리초 단위) — 순서/누락 진단용 */
  type DispatchRow = {
    seq: number;
    position: number;
    code: string;
    scanAt: string | null;
    dispatchAt: number;
    ackAt: number | null;
    ok: boolean | null;
    gatewayJobId: string | null;
    printedAt: string | null;
    error: string | null;
  };
  const [dispatchLog, setDispatchLog] = useState<DispatchRow[]>([]);

  /** 프린터가 보내온 실제 출력 완료 이벤트 (code → 완료 시각) */
  const [completeEvents, setCompleteEvents] = useState<Record<string, string>>({});
  /** 프린터 서버 큐는 최근 100건만 유지하므로, printed=true 확인 건은 화면에서 자체 누적한다. */
  const [printedAcc, setPrintedAcc] = useState<Record<string, string>>({});


  // 게이트웨이는 대기열/이력 삭제 API가 없어서, 초기화 시점 이후 데이터만 화면에 표시한다.
  // 컷오프는 서버에 저장해 모든 기기(패드)에서 동일하게 적용하고,
  // 서버 조회가 실패(권한/네트워크)해도 화면이 옛 기록을 보여주지 않도록 로컬에도 캐시한다.
  const cutoffKey = `barcode-print-cutoff:${kind}:${order.id}`;
  const [cutoff, setCutoff] = useState<string | null>(() => {
    try { return localStorage.getItem(cutoffKey); } catch { return null; }
  });
  const cutoffRef = useRef<string | null>(cutoff);
  useEffect(() => {
    cutoffRef.current = cutoff;
    try { if (cutoff) localStorage.setItem(cutoffKey, cutoff); } catch { /* ignore */ }
  }, [cutoff, cutoffKey]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("barcode_print_resets")
        .select("cutoff_at")
        .eq("kind", kind)
        .eq("order_id", order.id)
        .maybeSingle();
      if (!alive) return;
      if (error) return; // 조회 실패 시 로컬 캐시 유지
      const v = (data as any)?.cutoff_at ?? null;
      const next = v ? new Date(v).toISOString() : null;
      // 더 최신 컷오프만 반영 (폴링이 초기화를 되돌리지 않도록)
      if (next && ts(next) > ts(cutoffRef.current)) setCutoff(next);
    };
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [kind, order.id]);

  const [printerTestText, setPrinterTestText] = useState("TEST123");
  const [printerTesting, setPrinterTesting] = useState(false);
  // 라벨 명령 템플릿은 백엔드(게이트웨이)에서 관리하므로 화면 설정 없음

  const seenRef = useRef<Set<string>>(new Set());
  const lastCodeRef = useRef<string>("");
  // 게이트웨이 스캔 이력 기반 처리: 이미 처리한 이벤트 id / 최초 프라이밍 여부
  const processedRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const [queue, setQueue] = useState<ScanEvent[]>([]);





  // 기대 스캔 순서 = 고유번호(개별 주문번호 + suffix) 순서
  const expected = useMemo(() => buildExpected(order, suffix), [order, suffix]);

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

    // 진행 위치 복원 = 스캔 검증이 끝난(인쇄 대기 포함) 마지막 항목
    let c = 0;
    seenRef.current = new Set();
    for (const e of expected) {
      const st = map[e.position]?.status;
      if (st === "done" || st === "queued" || st === "error") { c = e.position; seenRef.current.add(norm(e.no)); }
      else break;
    }
    setCursor(c);
    // 인쇄 실패로 남아있는 항목이 있으면 작업을 중단 상태로 복원
    setHalted(Object.values(map).some((s) => s.status === "error"));
    setReady(true);
  }, [expected, kind, order.id]);

  useEffect(() => { setReady(false); loadSaved(); }, [loadSaved]);

  /** 스캔 검증 통과 → 인쇄 대기열(FIFO)에 적재. 실제 인쇄는 소비자 루프가 담당한다. */
  const markQueued = useCallback(async (position: number, code: string, scannedValue: string | null) => {
    const now = new Date().toISOString();
    await supabase.from("barcode_print_items").upsert(
      {
        kind, order_id: order.id, position, code,
        status: "queued", verdict: "ok", scanned_value: scannedValue,
        scanned_at: now, printed_at: null, test_mode: false,
      },
      { onConflict: "kind,order_id,position" },
    );
    setSaved((prev) => ({ ...prev, [position]: { position, code, status: "queued", test_mode: false, printed_at: null } }));
  }, [kind, order.id]);

  /** 인쇄 실패 → 대기열 선두에서 멈춤 (다음 항목으로 넘어가지 않음) */
  const markPrintError = useCallback(async (position: number, code: string, message: string) => {
    await supabase.from("barcode_print_items").upsert(
      { kind, order_id: order.id, position, code, status: "error", verdict: "print_failed", printed_at: null },
      { onConflict: "kind,order_id,position" },
    );
    setSaved((prev) => ({ ...prev, [position]: { position, code, status: "error", test_mode: false, printed_at: null } }));
    setHalted(true);
    toast.error(`${code} · ${message}`);
  }, [kind, order.id]);

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
   * 수동 전송(재인쇄·테스트)용 경로.
   * 정상 작업 흐름에서는 백엔드(게이트웨이)가 스캔 값을 프린터 큐에 자동 투입하므로
   * 프론트엔드에서 라벨 명령 템플릿을 만들지 않고, 값 그대로만 전송한다.
   */
  /** 프린터로 실제 전송할 값 — 카드 고유번호(개별 주문번호 + suffix) 그대로 */
  const printValueRef = useRef<(no: string) => string>((v) => v);
  useEffect(() => {
    const map = new Map<string, string>();
    for (const e of expected) {
      map.set(norm(e.no), e.no);
      map.set(norm(e.base), e.no);
      if (e.cardNo) map.set(norm(e.cardNo), e.no);
    }
    printValueRef.current = (v: string) => map.get(norm(v)) ?? String(v ?? "").trim();
  }, [expected]);

  const sendToPrinter = useCallback(async (code: string): Promise<{ ok: boolean; printed?: boolean; id?: string; error?: string }> => {
    const payload = String(code ?? "").slice(0, 200);
    const record = (ok: boolean, error: string | null) => {
      setPrinterLog((prev) => [
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), code, payload, ok, error },
        ...prev,
      ].slice(0, 100));
    };
    // PF 프린터 인쇄 (POST /api/v1/pf-printer/test) — 개정 서버는 접수 즉시 응답하며,
    // 프린터가 idle이었으면 printed=true(물리 인쇄 완료 확인)가 바로 붙어 온다.
    const r = await pfPrint(payload);
    record(r.ok, r.ok ? null : r.error ?? null);
    if (r.ok && r.printed) {
      const at = new Date().toISOString();
      setPrintedAcc((prev) => ({ ...prev, [norm(code)]: at }));
    }
    return r.ok ? { ok: true, printed: r.printed, id: r.id } : { ok: false, error: r.error };
  }, []);





  // ── 스캐너 폴링 (프린터 큐와 분리) ─────────────────────────────────
  // 게이트웨이는 /pf-printer/* 요청을 하나의 FIFO 큐로 직렬 처리하므로, 프린터 상태 조회를
  // 스캔 폴링과 같은 tick 에 묶으면 인쇄가 진행되는 동안 스캔 이력 수집까지 함께 지연된다.
  // → 스캔(status/history)은 1초 주기로 독립 실행해 검증이 건건이 즉시 이뤄지게 한다.
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [sRes, hRes] = await Promise.all([
          proxyFetch("/api/v1/scan/status"),
          proxyFetch("/api/v1/scan/history"),
        ]);
        const s: any = await sRes.json();
        if (!alive) return;
        if (!sRes.ok || "upstream_status" in s) { setOffline(true); }
        else { setOffline(false); setStatus(s as ScanStatus); }
        const cut = ts(cutoffRef.current);
        if (hRes.ok) {
          const h: any = await hRes.json();
          if (Array.isArray(h?.events)) {
            const events = (h.events as ScanEvent[])
              .filter((e) => ts(e.scanned_at) > cut)
              .sort((a, b) => ts(a.scanned_at) - ts(b.scanned_at));
            setHistory(events.slice(-100).slice().reverse());

            // 게이트웨이 이력 기반 검증: 폴링 간격 안에 여러 건이 스캔돼도 모두 순서대로 처리한다.
            const fresh = events.filter((e) => !processedRef.current.has(e.id));
            for (const e of fresh) processedRef.current.add(e.id);
            if (!primedRef.current) primedRef.current = true; // 최초 진입 시 기존 이력은 재처리하지 않음
            else if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
          }
        }
      } catch {
        if (alive) setOffline(true);
      } finally {
        inFlight = false;
        if (alive) setProbed(true);
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // ── 프린터 상태/큐 폴링 ────────────────────────────────────────────
  // 상태 조회도 같은 FIFO 큐를 소비하므로, 인쇄가 진행 중일 때는 폴링을 건너뛰어
  // 실제 인쇄 요청이 조회 요청 뒤에서 대기하지 않도록 한다.
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const tick = async () => {
      if (inFlight || inFlightRef.current > 0) return;
      inFlight = true;
      try {
        const [pf, q] = await Promise.all([pfPrinterStatus(), pfPrinterQueue()]);
        if (!alive) return;
        const cut = ts(cutoffRef.current);
        setPrinterOffline(pf.offline && q.offline);
        setPendingCount(q.offline ? (pf.buffer_count ?? 0) : q.pendingCount);
        if (!q.offline) {
          const rows = q.jobs
            .filter((j) => j.kind === "print" && ts(j.submitted_at) > cut)
            .map((j) => ({
              id: j.id,
              barcode: j.text ?? "",
              status: j.status === "processing" ? "printing" as const : j.status,
              enqueued_at: j.submitted_at,
              printed_at: j.completed_at,
              printed: j.printed ?? null,
              error: j.error,
            }));
          setJobs(rows.slice().reverse());
          // 인쇄완료(printed=true) 확인 건은 큐에서 밀려나도 남도록 누적 저장
          setPrintedAcc((prev) => mergePrintedAcc(prev, rows));
        }
      } catch {
        if (alive) setPrinterOffline(true);
      } finally {
        inFlight = false;
      }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, []);


  // 프린터 출력 완료 이벤트 폴링 (print-complete-event 로 수신되어 DB에 적재된 기록)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const cut = cutoffRef.current;
      let q = supabase
        .from("print_complete_events")
        .select("code, event_at, printed")
        .eq("printed", true)
        .order("event_at", { ascending: false })
        .limit(500);
      if (cut) q = q.gt("event_at", cut);
      const { data } = await q;
      if (!alive || !data) return;
      const map: Record<string, string> = {};
      for (const r of data as Array<{ code: string; event_at: string }>) {
        const k = norm(r.code);
        if (!map[k] || ts(r.event_at) > ts(map[k])) map[k] = r.event_at;
      }
      setCompleteEvents(map);
    };
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);



  // 새 스캔 이벤트 큐 처리 → 순서/정보 검증 (테스트 모드에서는 스캔 무시)
  useEffect(() => {
    if (queue.length === 0) return;
    if (!ready || testMode) { setQueue([]); return; }
    const events = queue;
    setQueue([]);

    const res = verifyScanBatch({
      events,
      expected,
      cursor,
      seen: seenRef.current,
      halted,
      lastCode: lastCodeRef.current,
    });
    if (res.rows.length === 0) return;
    seenRef.current = res.seen;
    lastCodeRef.current = res.lastCode;
    // 생산자(스캔)는 검증 후 인쇄 대기열에 적재만 한다 — 실제 인쇄는 소비자 루프가 순서대로 처리
    for (const r of res.rows) {
      if (r.enqueue && r.position != null) void markQueued(r.position, expected[r.position - 1].no, r.barcode);
    }
    setCursor(res.cursor);
    setLastVerdict(res.lastVerdict);
    if (res.halted) setHalted(true);
    // 경고등: 불일치 시 적색 점등(유지), 통과 시 녹색 점등(0.5초 후 자동 소등)
    // — 서버 딜레이 개선(단일 요청 다중 채널)으로 녹색 플래시를 다시 사용한다.
    if (res.halted && !halted) void warnLightError();
    else if (res.rows.some((r) => r.verdict === "ok")) void warnLightOkFlash();
    const rows: LogRow[] = res.rows.map(({ at, barcode, verdict, expected: exp, position }) => ({ at, barcode, verdict, expected: exp, position }));
    setLog((prev) => [...rows.slice().reverse(), ...prev].slice(0, 100));
  }, [queue, expected, cursor, testMode, ready, markQueued, kind, halted]);


  // ── 소비자(단일 Print Dispatcher) ─────────────────────────────────
  // 원칙: 단일 consumer · 한 번에 1건 · 게이트웨이 ACK(200 OK) 수신 후 다음 건 전송 ·
  // 실패 시 즉시 halt. 전송 순서는 항상 position ASC 이며 HTTP 응답 순서와 무관하다.
  // 물리 인쇄 완료는 기다리지 않고, /queue 폴링 + 0x40 완료 이벤트로 별도 확정한다.
  const dispatchedRef = useRef<Set<number>>(new Set());
  /** 단일 소비자 락 — 동시에 2개 이상의 /pf-printer/test 요청이 나가지 않도록 보장 */
  const busyRef = useRef(false);
  const inFlightRef = busyRef; // 프린터 상태 폴링에서 참조 (인쇄 중 폴링 스킵)
  const [inFlightCount, setInFlightCount] = useState(0);
  const [printingPos, setPrintingPos] = useState<number | null>(null);
  const dispatchSeqRef = useRef(1000);
  const gateRef = useRef({ ready, testMode, halted });
  gateRef.current = { ready, testMode, halted };

  const pump = useCallback(async () => {
    if (busyRef.current) return; // 이미 다른 소비자가 실행 중
    busyRef.current = true;
    try {
      // 대기열이 빌 때까지 한 건씩 순차 전송 (ACK 후 다음 건)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const g = gateRef.current;
        if (!g.ready || g.testMode || g.halted) break;
        const next = Object.values(savedRef.current)
          .filter((s) => s.status === "queued" && !dispatchedRef.current.has(s.position))
          .sort((a, b) => a.position - b.position)[0];
        if (!next) break;

        dispatchedRef.current.add(next.position);
        const seq = ++dispatchSeqRef.current;
        const dispatchAt = Date.now();
        setPrintingPos(next.position);
        setInFlightCount(1);
        setDispatchLog((prev) => [
          { seq, position: next.position, code: next.code, scanAt: null, dispatchAt, ackAt: null, ok: null, gatewayJobId: null, printedAt: null, error: null },
          ...prev,
        ].slice(0, 200));

        const r = await sendToPrinter(printValueRef.current(next.code));
        const ackAt = Date.now();
        setDispatchLog((prev) => prev.map((row) => (row.seq === seq
          ? { ...row, ackAt, ok: r.ok, gatewayJobId: r.id ?? null, error: r.ok ? null : r.error ?? "send failed" }
          : row)));

        if (r.ok) {
          // printed=true → 이미 물리 인쇄 확인. null/false 는 "버퍼 접수됨"이며 오류가 아니다.
          if (r.printed) await markDone(next.position, next.code, null, false);
        } else {
          dispatchedRef.current.delete(next.position); // 재시도 가능하도록 해제 (queued 유지)
          await markPrintError(next.position, next.code, r.error ?? "printer send failed");
          break; // Fail-fast: 이후 항목은 전송하지 않는다
        }
      }
    } finally {
      busyRef.current = false;
      setInFlightCount(0);
      setPrintingPos(null);
    }
  }, [sendToPrinter, markDone, markPrintError]);

  // 상태가 바뀔 때마다 디스패처를 깨운다 (실행 중이면 pump 가 즉시 반환하므로 중복 없음)
  useEffect(() => { void pump(); }, [saved, ready, testMode, halted, pump]);

  // ── 인쇄 완료 확인(큐 폴링 결과 반영) ───────────────────────────────
  // 접수만 된 항목(queued & 전송 완료)은 프린터 큐/완료 이벤트에서 실제 인쇄완료가
  // 확인되는 시점에 비로소 done 으로 확정한다.
  useEffect(() => {
    const pendingConfirm = Object.values(saved).filter(
      (s) => s.status === "queued" && dispatchedRef.current.has(s.position),
    );
    if (pendingConfirm.length === 0) return;
    for (const s of pendingConfirm) {
      const pv = printValueRef.current(s.code);
      const codes = [s.code, pv];
      const job = jobs.find((j) => codes.some((c) => norm(c) === norm(j.barcode))) ?? null;
      const at = resolvePrintedAt({ codes, completeEvents, printedAcc, job });
      if (at) {
        setDispatchLog((prev) => prev.map((row) => (row.position === s.position && !row.printedAt ? { ...row, printedAt: at } : row)));
        void markDone(s.position, s.code, null, false);
      }
    }
  }, [saved, jobs, completeEvents, printedAcc, markDone]);


  /** 스캔 없이 남은 항목 전체를 인쇄 대기열(FIFO)에 적재 */
  const enqueueAllRemaining = useCallback(async () => {
    const targets = expected.filter((e) => {
      const st = saved[e.position]?.status;
      return st !== "done" && st !== "queued";
    });
    if (targets.length === 0) {
      toast.info(tr("대기열에 추가할 항목이 없습니다", "没有可加入队列的项目"));
      return;
    }
    const now = new Date().toISOString();
    const rows = targets.map((e) => ({
      kind, order_id: order.id, position: e.position, code: e.no,
      status: "queued", verdict: "ok", scanned_value: null,
      scanned_at: now, printed_at: null, test_mode: false,
    }));
    const { error } = await supabase.from("barcode_print_items").upsert(rows, { onConflict: "kind,order_id,position" });
    if (error) { toast.error(error.message); return; }
    setSaved((prev) => {
      const next = { ...prev };
      for (const e of targets) next[e.position] = { position: e.position, code: e.no, status: "queued", test_mode: false, printed_at: null };
      return next;
    });
    for (const e of targets) seenRef.current.add(norm(e.no));
    setCursor(Math.max(cursor, ...targets.map((t) => t.position)));
    setHalted(false);
    toast.success(`${tr("인쇄 대기열에 추가했습니다", "已加入打印队列")} · ${targets.length}`);
  }, [expected, saved, kind, order.id, cursor, isKo]);

  /**
   * 인쇄 대기열 초기화 — 프린터 서버 FIFO 큐(pending)까지 함께 취소하고,
   * 앱 측 대기(queued)/실패(error) 항목을 제거한다. 완료 기록은 유지.
   */
  const clearQueue = useCallback(async () => {
    const cleared = await pfPrinterQueueClear();
    const targets = Object.values(saved).filter((s) => s.status === "queued" || s.status === "error");
    if (targets.length === 0 && cleared.cleared === 0) {
      toast.info(tr("초기화할 대기열 항목이 없습니다", "没有可清空的队列项目"));
      return;
    }
    if (targets.length > 0) {
      const { error } = await supabase
        .from("barcode_print_items")
        .delete()
        .eq("kind", kind)
        .eq("order_id", order.id)
        .in("status", ["queued", "error"]);
      if (error) { toast.error(error.message); return; }
      // 전송 중(in-flight)이 아닌 항목은 재디스패치 가능 상태로 정리
      for (const s of targets) dispatchedRef.current.delete(s.position);
      setSaved((prev) => {
        const next = { ...prev };
        for (const s of targets) delete next[s.position];
        return next;
      });
    }
    setHalted(false);
    toast.success(
      `${tr("인쇄 대기열을 초기화했습니다", "打印队列已清空")} · ${tr("앱", "应用")} ${targets.length} · ${tr("프린터", "打印机")} ${cleared.ok ? cleared.cleared : "-"}`,
    );
  }, [saved, kind, order.id, isKo]);







  /** 실패한 항목을 다시 대기열로 되돌리고 인쇄 재개 */
  const retryFailed = async () => {
    const bad = Object.values(saved).filter((s) => s.status === "error");
    for (const b of bad) {
      await supabase.from("barcode_print_items")
        .update({ status: "queued", verdict: "ok" })
        .eq("kind", kind).eq("order_id", order.id).eq("position", b.position);
    }
    setSaved((prev) => {
      const next = { ...prev };
      for (const b of bad) next[b.position] = { ...b, status: "queued" };
      return next;
    });
    setHalted(false);
  };



  // 전체 초기화 — 서버 기록 삭제 + 게이트웨이 대기열/이력 표시 컷오프 갱신
  const resetAll = async () => {
    const now = new Date().toISOString();

    // 1) 게이트웨이 스캔 카운터 초기화 (대기열/이력 삭제 API는 게이트웨이에 없음)
    await proxyFetch("/api/v1/scan/reset", { method: "POST", body: "{}" }).catch(() => null);

    // 2) 서버(DB)에 저장된 이 주문의 작업 기록 삭제
    const { error: delErr } = await supabase
      .from("barcode_print_items")
      .delete()
      .eq("kind", kind)
      .eq("order_id", order.id);
    if (delErr) {
      toast.error(tr(`초기화 실패: ${delErr.message}`, `复位失败: ${delErr.message}`));
      return;
    }

    // 3) 공유 컷오프 저장 (모든 기기에서 이전 대기열/이력 숨김)
    const { error: upErr } = await supabase
      .from("barcode_print_resets")
      .upsert({ kind, order_id: order.id, cutoff_at: now }, { onConflict: "kind,order_id" });
    if (upErr) {
      toast.error(tr(`초기화 기준 저장 실패: ${upErr.message}`, `复位基准保存失败: ${upErr.message}`));
      return;
    }

    // 4) 저장 확인 (RLS 등으로 조용히 실패하는 경우 방지)
    const { data: check } = await supabase
      .from("barcode_print_resets")
      .select("cutoff_at")
      .eq("kind", kind)
      .eq("order_id", order.id)
      .maybeSingle();
    const serverCut = (check as any)?.cutoff_at ? new Date((check as any).cutoff_at).toISOString() : null;
    if (!serverCut) {
      toast.error(tr("초기화 기준이 서버에 저장되지 않았습니다", "复位基准未保存到服务器"));
      return;
    }

    setCutoff(serverCut);
    cutoffRef.current = serverCut;
    setJobs([]);
    setPrintedAcc({});
    setCompleteEvents({});
    setHistory([]);
    setQueue([]);
    setPendingCount(0);
    seenRef.current = new Set();
    setCursor(0);
    setLog([]);
    setLastVerdict(null);
    setHalted(false);
    // 초기화 직후 기존 게이트웨이 이력이 다시 검증되지 않도록 프라이밍을 다시 수행
    primedRef.current = false;
    processedRef.current = new Set();
    lastCodeRef.current = "";
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
    lastCodeRef.current = "";
    await loadSaved();
    toast.success(tr(`${position}번부터 다시 작업합니다`, `从第 ${position} 项重新作业`));
  };

  // 개별 재작업(스캔 없이 즉시 인쇄)
  const reprint = async (position: number, code: string) => {
    const r = await sendToPrinter(printValueRef.current(code));
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
    const r = await sendToPrinter(printValueRef.current(target.no));
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
    const text = (printerTestText || "TEST123").slice(0, 60);
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
  const queuedCount = Object.values(saved).filter((s) => s.status === "queued").length;
  const errorCount = Object.values(saved).filter((s) => s.status === "error").length;
  // 서버에 저장된 FIFO 인쇄 대기열 (스캔 검증 통과분 + 실패로 멈춘 항목)
  const queueItems = Object.values(saved)
    .filter((s) => s.status === "queued" || s.status === "error")
    .sort((a, b) => a.position - b.position);
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

  // 프린터 장비 상태 (게이트웨이 인쇄 대기열 기준)
  // 인쇄 완료 = 프린터가 인쇄완료(0x40) 응답까지 보낸 job만 카운트
  const doneJobs = jobs.filter((j) => j.status === "done");
  const printedJobs = doneJobs.filter((j) => j.printed === true).length;
  // 패널2(인쇄 대기열) = pending/processing + (done 이지만 인쇄완료 미확인)
  const waitingJobs = selectWaitingJobs(jobs);

  // ── 인쇄 대기열 표시 데이터 ────────────────────────────────────────
  // 프린터 서버 FIFO 큐에 실제 대기/처리 중인 건 + 앱에서 전송 중인 건 + 실패로 멈춘 건
  type QueueState = "printing" | "printer_wait" | "unconfirmed" | "sending" | "error";
  const queueStateMeta: Record<QueueState, { ko: string; zh: string; cls: string }> = {
    printing: { ko: "프린터 인쇄 중", zh: "打印机打印中", cls: "text-primary" },
    printer_wait: { ko: "프린터 대기 중", zh: "打印机等待中", cls: "text-primary" },
    unconfirmed: { ko: "인쇄 완료 미확인", zh: "打印完成未确认", cls: "text-amber-500" },
    sending: { ko: "전송 중", zh: "发送中", cls: "text-primary" },
    error: { ko: "인쇄 실패 · 작업 중단", zh: "打印失败 · 作业中断", cls: "text-destructive" },
  };
  const posByPrintValue: Record<string, number> = {};
  for (const e of expected) {
    posByPrintValue[norm(e.no)] = e.position;
    posByPrintValue[norm(e.base)] = e.position;
    if (e.cardNo) posByPrintValue[norm(e.cardNo)] = e.position;
  }
  const queueRows: Array<{ key: string; position: number | null; code: string; state: QueueState }> = [
    // 프린터 서버 큐 (오래된 요청 순 = 인쇄 순서)
    ...waitingJobs
      .slice()
      .sort((a, b) => ts(a.enqueued_at) - ts(b.enqueued_at))
      .map((j) => ({
        key: `job-${j.id}`,
        position: posByPrintValue[norm(j.barcode)] ?? null,
        code: j.barcode,
        state: (j.status === "done" ? "unconfirmed" : j.status === "printing" ? "printing" : "printer_wait") as QueueState,
      })),
    // 아직 프린터 큐에 반영되기 전(앱→게이트웨이 전송 중)
    ...Object.values(saved)
      .filter((s) => s.status === "queued" && !jobByCodePending(s))
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        key: `send-${s.position}`,
        position: s.position,
        code: printValueRef.current(s.code),
        state: "sending" as QueueState,
      })),
    // 실패로 멈춘 건
    ...Object.values(saved)
      .filter((s) => s.status === "error")
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        key: `err-${s.position}`,
        position: s.position,
        code: printValueRef.current(s.code),
        state: "error" as QueueState,
      })),
  ];
  function jobByCodePending(s: SavedItem) {
    const j = jobs.find((x) => norm(x.barcode) === norm(printValueRef.current(s.code)));
    return !!j && (j.status === "pending" || j.status === "printing");
  }
  // 인쇄 완료 목록 = 이 주문에서 실제 검증 후 인쇄 처리된 항목 (초기화 시 함께 지워짐)
  // 게이트웨이 인쇄 대기열에서 바코드별 최종 상태 조회용 맵
  const jobByCode: Record<string, PrintJob> = {};
  for (const j of jobs) {
    const k = norm(j.barcode);
    const prev = jobByCode[k];
    if (!prev || ts(j.printed_at ?? j.enqueued_at) >= ts(prev.printed_at ?? prev.enqueued_at)) jobByCode[k] = j;
  }
  // 패널3(인쇄 완료) = 실제 인쇄완료(printed=true) 또는 프린터 완료 이벤트가 확인된 항목만
  const printedItems = expected
    .map((e) => {
      const pv = norm(printValueRef.current(e.no));
      const codes = [e.no, pv];
      const job = jobByCode[pv] ?? jobByCode[norm(e.no)] ?? null;
      const event = completeEvents[norm(e.no)] ?? completeEvents[pv] ?? null;
      return { e, s: saved[e.position], job, event, at: resolvePrintedAt({ codes, completeEvents, printedAcc, job }) };
    })
    .filter((r) => !!r.at)
    .sort((a, b) => a.e.position - b.e.position);
  const confirmedPrinted = printedItems.length;




  const failedJobs = jobs.filter((j) => j.status === "failed").length;
  const lastJob = jobs[0] ?? null;
  const printerOk = !printerOffline && failedJobs === 0;


  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`${tr(titleKo, titleZh)} · ${order.external_order_id}`}
        description={`${tr("상품", "商品")} ${order.product_code} · ${tr("수량", "数量")} ${order.quantity}`}
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              <RotateCcw className="w-4 h-4" />{tr("초기화", "复位")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("작업을 초기화할까요?", "确定复位该作业吗？")}</AlertDialogTitle>
              <AlertDialogDescription>
                {tr(
                  "이 주문건의 스캔·인쇄 기록이 모두 삭제되고 처음부터 다시 작업할 수 있습니다.",
                  "该订单的扫描与打印记录将全部删除，可从头重新作业。",
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("취소", "取消")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { void resetAll(); }}>{tr("초기화", "复位")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button variant="outline" size="sm" className="gap-1" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" />{tr("주문 목록", "订单列表")}
        </Button>

      </PageHeader>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {/* 장비 상태 (스캐너 · 프린터) */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <ScanLine className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {kind === "card" ? tr("카드 DM 바코드 스캐너", "卡片DM条码扫描仪") : tr("티셔츠 바코드 스캐너", "T恤条码扫描仪")}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {tr("누적", "累计")} {status?.count ?? 0} · {tr("최근", "最近")}{" "}
                  {status?.last_seen ? new Date(status.last_seen).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN") : "-"}
                  {status?.last_duration != null && ` · ${status.last_duration}s`}
                </p>
              </div>
              {!probed ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground shrink-0">
                  <Loader2 className="w-3 h-3 animate-spin" />{tr("확인 중", "检查中")}
                </Badge>
              ) : offline || !status?.connected ? (
                <Badge variant="outline" className="gap-1 text-destructive border-destructive/40 shrink-0">
                  <WifiOff className="w-3 h-3" />{tr("연결 끊김", "连接断开")}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40 shrink-0">
                  <Wifi className="w-3 h-3" />{tr("연결됨", "已连接")}
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card className={probed && printerOffline ? "border-destructive" : ""}>
            <CardContent className="p-4 flex items-center gap-4">
              <Printer className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {kind === "card" ? tr("카드 QR 인쇄기", "卡片二维码打印机") : tr("티셔츠 QR 인쇄기", "T恤二维码打印机")}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {tr("대기", "等待")} {pendingCount} · {tr("완료", "完成")} {printedJobs} · {tr("실패", "失败")} {failedJobs}
                  {lastJob && ` · ${tr("최근", "最近")} ${lastJob.barcode}`}
                </p>
                {lastJob?.error && <p className="text-[11px] text-destructive truncate">{lastJob.error}</p>}
              </div>
              {!probed ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground shrink-0">
                  <Loader2 className="w-3 h-3 animate-spin" />{tr("확인 중", "检查中")}
                </Badge>
              ) : printerOffline ? (
                <Badge variant="outline" className="gap-1 text-destructive border-destructive/40 shrink-0">
                  <WifiOff className="w-3 h-3" />{tr("연결 끊김", "连接断开")}
                </Badge>
              ) : printerOk ? (
                <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40 shrink-0">
                  <Wifi className="w-3 h-3" />{tr("정상", "正常")}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400 border-amber-500/40 shrink-0">
                  <AlertTriangle className="w-3 h-3" />{tr("인쇄 실패 있음", "存在打印失败")}
                </Badge>
              )}
            </CardContent>
          </Card>
        </div>

        <PfPrinterCard />

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
              <p className="text-3xl font-semibold tabular-nums">{queuedCount}</p>
              <p className="text-[11px] text-muted-foreground">
                {tr("인쇄 대기열", "打印队列")}
                {errorCount > 0 && <span className="text-destructive"> · {tr("실패", "失败")} {errorCount}</span>}
              </p>
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
              ) : !probed ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground justify-center">
                  <Loader2 className="w-3 h-3 animate-spin" />{tr("스캐너 확인 중", "扫描仪检查中")}
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
                  <Button size="sm" className="flex-1 gap-1 h-9" onClick={() => { void (errorCount > 0 ? retryFailed() : Promise.resolve(setHalted(false))); }}>
                    <Play className="w-3.5 h-3.5" />{errorCount > 0 ? tr("재인쇄 후 재개", "重印并恢复") : tr("재개", "恢复")}
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

        {/* 자동 인쇄는 백엔드(게이트웨이)가 처리 */}


        {/* 프린터 진단 (POST /api/v1/pf-printer/test) */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="min-w-[200px]">
              <p className="text-sm font-medium flex items-center gap-2">
                <Printer className="w-4 h-4" />{tr("프린터 연결 테스트", "打印机连接测试")}
              </p>
              <p className="text-xs text-muted-foreground">
                {tr("대기열을 거치지 않고 임의 텍스트를 프린터로 즉시 전송합니다 (기록에 남지 않음)",
                    "不经队列，直接向打印机发送任意文本（不留记录）")}
              </p>
            </div>
            <Input
              value={printerTestText}
              onChange={(e) => setPrinterTestText(e.target.value.slice(0, 60))}
              placeholder="TEST123"
              className="w-48 font-mono"
            />
            <Button size="sm" variant="outline" className="gap-1" onClick={runPrinterTest} disabled={printerTesting}>
              {printerTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              {tr("테스트 인쇄", "测试打印")}
            </Button>
            <span className="text-[11px] text-muted-foreground ml-auto">
              {kind === "card"
                ? tr("연결 장비: 카드 바코드 프린터 · 카드 DM 스캐너", "连接设备：卡片条码打印机 · 卡片DM扫描仪")
                : tr("※ 현재 게이트웨이에는 카드용 장비만 연결되어 있습니다 (티셔츠 장비 추가 예정)",
                     "※ 当前网关仅连接卡片设备（T恤设备待接入）")}
            </span>
          </CardContent>
        </Card>

        {/* 인쇄 처리 안내 — 명령 생성은 백엔드(게이트웨이)가 담당 */}
        <Card>
          <CardContent className="p-4 flex items-start gap-3">
            <Printer className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              {tr("스캐너에서 스캔된 값은 백엔드(게이트웨이)가 자동으로 프린터 큐에 넣어 출력합니다. 화면에서는 라벨 명령 템플릿을 만들지 않고, 스캔 순서 검증과 게이트웨이 인쇄 결과만 확인·기록합니다. 라벨 형식(SIZE/GAP/QR 등)은 게이트웨이·프린터 설정에서 관리하세요.",
                  "扫描仪扫描到的值由后端（网关）自动进入打印队列并输出。本界面不再生成标签命令模板，仅进行扫描顺序检验并记录网关打印结果。标签格式（SIZE/GAP/二维码等）请在网关与打印机侧设置。")}
            </p>
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
                  // 스캔 검증을 통과하면 즉시 '완료'로 표시 (인쇄 결과와 무관)
                  const done = rec?.status === "done" || rec?.status === "queued" || rec?.status === "error";
                  const current = i === cursor;
                  return (
                    <div key={i} className={`flex items-center gap-2 py-2.5 px-2 text-sm ${current ? "bg-primary/10 rounded" : ""}`}>
                      <span className="w-7 tabular-nums text-muted-foreground">{e.position}</span>
                      <span className="flex-1 font-mono text-xs break-all">
                        {e.no}
                        {e.cardNo && (
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            {tr("인쇄값", "打印值")}: {e.cardNo}
                          </span>
                        )}
                      </span>

                      {done ? (
                        <Badge variant="outline" className="shrink-0 text-[10px] gap-1 border-emerald-500/50 text-emerald-500">
                          <CheckCircle2 className="w-3 h-3" />{tr("완료", "完成")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={`shrink-0 text-[10px] ${current ? "border-primary text-primary" : "text-muted-foreground"}`}>
                          {tr("대기", "等待")}
                        </Badge>
                      )}
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

          {/* 인쇄 대기열 — 프린터 서버 FIFO 큐에 실제 대기/처리 중인 건 */}
          <Card className={errorCount > 0 ? "border-destructive" : ""}>
            <CardHeader className="pb-3 space-y-2">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <Printer className="w-4 h-4" />{tr("인쇄 대기열", "打印队列")}
                <span className="text-xs font-normal text-muted-foreground">({printerOffline ? "-" : waitingJobs.length})</span>
                <span className="text-[11px] font-normal text-muted-foreground ml-auto">
                  {tr("전송 중", "发送中")} {inFlightCount}
                  {errorCount > 0 && <span className="text-destructive"> · {tr("실패", "失败")} {errorCount}</span>}
                </span>
              </CardTitle>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="gap-1 h-8 flex-1" onClick={() => void enqueueAllRemaining()}>
                  <Printer className="w-3.5 h-3.5" />{tr("남은 항목 전체 대기열 추가", "将剩余项目全部加入队列")}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1 h-8" disabled={queueItems.length === 0 && pendingCount === 0}>
                      <Eraser className="w-3.5 h-3.5" />{tr("대기열 초기화", "清空队列")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{tr("인쇄 대기열을 초기화할까요?", "确定清空打印队列吗？")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {tr(
                          `대기 중 ${queuedCount}건${errorCount > 0 ? ` · 실패 ${errorCount}건` : ""}이 제거되고, 프린터 서버에서 아직 시작하지 않은 인쇄 요청도 함께 취소됩니다. 완료된 기록은 유지되고, 이미 프린터가 처리 중인 1건은 끝까지 출력됩니다.`,
                          `将移除等待中 ${queuedCount} 项${errorCount > 0 ? `、失败 ${errorCount} 项` : ""}，并取消打印服务器中尚未开始的请求。已完成的记录会保留，正在处理中的 1 项仍会打印完成。`
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{tr("취소", "取消")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => { void clearQueue(); }}>{tr("초기화", "清空")}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

              </div>
            </CardHeader>

            <CardContent>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-2 py-1.5">{tr("순번", "序号")}</th>
                      <th className="px-2 py-1.5">{tr("인쇄 값", "打印值")}</th>
                      <th className="px-2 py-1.5">{tr("상태", "状态")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueRows.length === 0 ? (
                      <tr><td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">{tr("프린터에 대기 중인 인쇄 작업이 없습니다", "打印机中暂无待打印作业")}</td></tr>
                    ) : queueRows.map((r) => (
                      <tr key={r.key} className={`border-t ${r.state === "error" ? "bg-destructive/5" : ""}`}>
                        <td className="px-2 py-1.5 tabular-nums">{r.position ?? "-"}</td>
                        <td className="px-2 py-1.5 font-mono break-all">{r.code}</td>
                        <td className={`px-2 py-1.5 font-medium ${queueStateMeta[r.state].cls}`}>
                          {isKo ? queueStateMeta[r.state].ko : queueStateMeta[r.state].zh}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>


          {/* 인쇄 완료 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />{tr("인쇄 완료", "打印完成")}
                <span className="text-xs font-normal text-muted-foreground">({printedItems.length}/{total})</span>
                <span className="text-[11px] font-normal text-muted-foreground ml-auto">
                  {tr("출력 완료 확인", "输出完成确认")} {confirmedPrinted}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-2 py-1.5">{tr("순번", "序号")}</th>
                      <th className="px-2 py-1.5">{tr("바코드", "条码")}</th>
                      <th className="px-2 py-1.5">{tr("인쇄 확인", "打印确认")}</th>

                      <th className="px-2 py-1.5">{tr("인쇄 시각", "打印时间")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printedItems.length === 0 ? (
                      <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">{tr("인쇄 완료 기록이 없습니다", "暂无打印完成记录")}</td></tr>
                    ) : printedItems.map(({ e, s, event, at }) => (
                      <tr key={e.position} className="border-t">
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{e.position}</td>
                        <td className="px-2 py-1.5 font-mono break-all">
                          {e.no}
                          {s?.test_mode && <span className="ml-1 text-[10px] text-amber-500">TEST</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          {event ? (
                            <span className="text-emerald-500">{tr("출력 완료(프린터 신호)", "输出完成(打印机信号)")}</span>
                          ) : (
                            <span className="text-emerald-500">{tr("인쇄 완료", "打印完成")}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {new Date(at as string).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}
                        </td>

                      </tr>
                    ))}

                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {tr(
                  "※ '출력 완료(프린터 신호)'는 프린터/게이트웨이가 완료 이벤트 API(print-complete-event)로 직접 통보한 실제 출력 완료 건입니다. 이벤트가 없는 항목은 게이트웨이 큐의 인쇄완료(0x40) 응답으로 판정하며, '완료 확인 지연'은 트리거는 성공했으나 완료 응답 수신이 타임아웃된 경우입니다.",
                  "※ '输出完成(打印机信号)'表示打印机/网关通过完成事件API(print-complete-event)直接通知的实际输出完成。无事件的项目按网关队列的打印完成(0x40)响应判定，'完成确认延迟'表示触发成功但完成响应超时。"
                )}

              </p>
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

        {/* 게이트웨이 원본 로그 (스캐너 / 프린터) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2">
                <ScanLine className="w-4 h-4" />{tr("게이트웨이 로그 (원본)", "网关日志（原始）")}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {rawTab === "scanner"
                  ? tr("스캐너가 실제로 보낸 값 · 최근 100건", "扫描仪实际发送值 · 最近100条")
                  : tr("프린터로 실제 전송한 명령 · 최근 100건", "实际发送至打印机的指令 · 最近100条")}
              </span>
            </CardTitle>
            <div className="flex gap-1 pt-2">
              <Button size="sm" variant={rawTab === "scanner" ? "default" : "outline"} onClick={() => setRawTab("scanner")} className="gap-1">
                <ScanLine className="w-3.5 h-3.5" />{tr("스캐너", "扫描仪")}
              </Button>
              <Button size="sm" variant={rawTab === "printer" ? "default" : "outline"} onClick={() => setRawTab("printer")} className="gap-1">
                <Printer className="w-3.5 h-3.5" />{tr("프린터", "打印机")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[360px] overflow-auto">
              {rawTab === "scanner" ? (
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-2 py-1.5">{tr("시간", "时间")}</th>
                      <th className="px-2 py-1.5">{tr("스캔 값", "扫描值")}</th>
                      <th className="px-2 py-1.5">{tr("간격", "间隔")}</th>
                      <th className="px-2 py-1.5">{tr("인쇄 상태", "打印状态")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">{tr("게이트웨이 스캔 기록이 없습니다", "网关暂无扫描记录")}</td></tr>
                    ) : history.map((h) => (
                      <tr key={h.id} className={`border-t ${h.print_status === "failed" ? "bg-destructive/5" : ""}`}>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {new Date(h.scanned_at).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}
                        </td>
                        <td className="px-2 py-1.5 font-mono break-all">{h.barcode}</td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{h.duration != null ? `${h.duration}s` : "-"}</td>
                        <td className={`px-2 py-1.5 font-medium ${jobMeta[h.print_status]?.cls ?? "text-muted-foreground"}`}>
                          {jobMeta[h.print_status]
                            ? (isKo ? jobMeta[h.print_status].ko : jobMeta[h.print_status].zh)
                            : tr("알 수 없음", "未知")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 whitespace-nowrap">{tr("시간", "时间")}</th>
                      <th className="px-2 py-1.5">{tr("바코드", "条码")}</th>
                      <th className="px-2 py-1.5">{tr("전송 명령 (원본)", "发送指令（原始）")}</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">{tr("응답", "响应")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printerLog.length === 0 ? (
                      <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">{tr("프린터 전송 기록이 없습니다 (이 화면에서 전송한 건만 표시)", "暂无打印发送记录（仅显示本页面发送的记录）")}</td></tr>
                    ) : printerLog.map((p) => (
                      <tr key={p.id} className={`border-t align-top ${p.ok ? "" : "bg-destructive/5"}`}>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap">
                          {new Date(p.at).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}
                        </td>
                        <td className="px-2 py-1.5 font-mono break-all">{p.code}</td>
                        <td className="px-2 py-1.5">
                          <pre className="font-mono text-[10px] whitespace-pre-wrap break-all max-h-24 overflow-auto bg-muted/40 rounded p-1.5">
                            {p.payload.replace(/\r/g, "\\r\n").replace(/\n(?!$)/g, "\n")}
                          </pre>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {p.ok ? (
                            <span className="text-emerald-500">{tr("수신됨", "已接收")}</span>
                          ) : (
                            <span className="text-destructive break-all">{tr("실패", "失败")}: {p.error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>


      </div>
    </div>
  );
}
