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
import { pfPrint, pfPrinterStatus, pfPrinterQueue, pfPrinterBufferClear, type PfErrorCode } from "@/lib/pf-printer";
import { verifyScanBatch, selectWaitingJobs, mergePrintedAcc, resolvePrintedAt, isCancelledJobError } from "@/lib/barcode-print-logic";

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
  scanned_at?: string | null;
  scanned_value?: string | null;
  /** 판정 시점에 시스템이 기대했던 값 (로그 표시용 — 렌더 시점 재계산 금지) */
  expected_value?: string | null;
  verdict?: string | null;
  scan_sequence?: number | null;
  dispatch_status?: "queued" | "dispatching" | "uncertain" | "accepted" | "waiting_for_print" | "printing" | "printed" | "error";
  gateway_job_id?: string | null;
  retry_count?: number;
  error_code?: string | null;
  error_detail?: string | null;
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
    return <OrderDetail key={selected.id} order={selected} onBack={() => setSelected(null)} {...props} />;
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
  // 스캔 판정 로그는 로컬 상태가 아니라 서버(barcode_print_items)에서 파생한다.
  const [cursor, setCursor] = useState(0);
  /** 검증에 사용하는 로컬 커서 — 서버 파생 커서와 max 로 병합해 동기화 지연 오판정을 막는다 */
  const cursorRef = useRef(0);
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
    scanSequence: number | null;
    position: number;
    code: string;
    scanAt: string | null;
    dispatchAt: number;
    ackAt: number | null;
    ok: boolean | null;
    gatewayJobId: string | null;
    printedAt: string | null;
    error: string | null;
    errorCode: string | null;
    responseCode: number | null;
    retryCount: number;
    runState: string | null;
    readyAt: string | null;
    serialSendAt: string | null;
    serialResponseAt: string | null;
    /** 프록시가 상위 게이트웨이 응답을 기다린 시간(ms) — 지연 구간 판별용 */
    proxyUpstreamMs: number | null;
  };
  const [dispatchLog, setDispatchLog] = useState<DispatchRow[]>([]);
  const [dispatchWake, setDispatchWake] = useState(0);

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
      if (next && ts(next) > ts(cutoffRef.current)) {
        setCutoff(next);
        cutoffRef.current = next;
        // 다른 기기에서 초기화된 경우: 이 기기에 남아 있는 이전 작업의 완료 근거를 모두 버린다.
        // (그대로 두면 재스캔한 항목이 옛 인쇄 기록과 값이 같다는 이유로 즉시 완료 처리되어 전송이 생략된다)
        setPrintedAcc({});
        setCompleteEvents({});
        setJobs([]);
        processedRef.current = new Set();
        dispatchedRef.current = new Set();
        primedRef.current = false;
        lastCodeRef.current = "";
      }

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

  /** 스캔 검증 로그 = 서버에 저장된 판정(verdict) 을 그대로 렌더 (모든 기기 동일) */
  const log = useMemo<LogRow[]>(() => {
    return Object.values(saved)
      .filter((s) => s.verdict != null && s.scanned_at)
      .map((s) => ({
        at: s.scanned_at as string,
        barcode: s.scanned_value ?? s.code,
        verdict: (s.verdict === "ok" || s.verdict === "order" || s.verdict === "mismatch" || s.verdict === "duplicate" ? s.verdict : "ok") as Verdict,
        // 기대값 = 주문 상세 목록(스캔 순서)의 해당 순번 값. 저장값은 폴백으로만 사용
        expected: expected[s.position - 1]?.no ?? s.expected_value ?? null,
        position: s.position,
      }))
      .sort((a, b) => ts(b.at) - ts(a.at) || (b.position ?? 0) - (a.position ?? 0))
      .slice(0, 100);
  }, [saved, expected]);

  // 서버에 저장된 작업 이력 로드 / 없으면 생성
  const loadSaved = useCallback(async () => {
    if (expected.length === 0) return;
    const { data } = await supabase
      .from("barcode_print_items")
        .select("position, code, status, test_mode, printed_at, scanned_at, scanned_value, expected_value, verdict, scan_sequence, dispatch_status, gateway_job_id, retry_count, error_code, error_detail")
      .eq("kind", kind)
      .eq("order_id", order.id)
      .order("position");

    const rows = (data ?? []) as SavedItem[];
    const existing = new Set(rows.map((r) => r.position));
    // 주문 데이터 순서대로 기대값을 미리 생성해 서버에 저장 — 이후 판정/표시는 이 값만 사용
    const missing = expected
      .filter((e) => !existing.has(e.position))
      .map((e) => ({ kind, order_id: order.id, position: e.position, code: e.no, status: "pending", dispatch_status: "queued", scan_sequence: e.position, expected_value: e.no }));
    if (missing.length > 0) {
      await supabase.from("barcode_print_items").upsert(missing, { onConflict: "kind,order_id,position" });
    }
    // 기존 행의 기대값이 비었거나 주문 순서와 다르면 주문 상세 목록 값으로 교정
    const backfill = expected.filter((e) => {
      const r = map0(e.position);
      return r && r.expected_value !== e.no;
    });
    function map0(pos: number) { return rows.find((r) => r.position === pos); }
    for (const b of backfill) {
      await supabase.from("barcode_print_items").update({ expected_value: b.no } as any).eq("kind", kind).eq("order_id", order.id).eq("position", b.position);
    }
    const map: Record<number, SavedItem> = {};
    for (const r of rows) map[r.position] = r;
    for (const m of missing) map[m.position] = { position: m.position, code: m.code, status: "pending", test_mode: false, printed_at: null, dispatch_status: "queued", scan_sequence: m.scan_sequence };
    setSaved(map);

    // 진행 위치 복원 = 스캔 검증이 끝난(인쇄 대기 포함) 마지막 항목
    let c = 0;
    const seenNext = new Set<string>();
    for (const e of expected) {
      const it = map[e.position];
      const st = it?.status;
      const v = it?.verdict ?? null;
      const passed = (st === "done" || st === "queued" || st === "error") && (v === null || v === "ok" || v === "print_failed");
      if (passed) {
        c = e.position;
        seenNext.add(norm(e.no));
        if (it?.scanned_value) seenNext.add(norm(it.scanned_value));
      }
      else break;
    }
    // 다른 기기가 더 앞서 처리한 상태가 서버에 있으면 그쪽을 따른다 (뒤로 후퇴하지 않음)
    seenRef.current = new Set([...seenRef.current, ...seenNext]);
    cursorRef.current = Math.max(cursorRef.current, c);
    setCursor(cursorRef.current);
    // 인쇄 실패 또는 서버에 기록된 검증 실패가 남아있으면 작업을 중단 상태로 복원
    setHalted(Object.values(map).some((s) => s.status === "error" || (s.verdict != null && s.verdict !== "ok")));
    setReady(true);
  }, [expected, kind, order.id]);

  useEffect(() => { setReady(false); loadSaved(); }, [loadSaved]);

  // 서버(barcode_print_items)를 단일 진실 소스로 사용 — 모든 기기가 같은 판정을 보도록 주기 동기화
  useEffect(() => {
    if (expected.length === 0) return;
    const iv = setInterval(() => { void loadSaved(); }, 4000);
    return () => clearInterval(iv);
  }, [loadSaved, expected.length]);

  /** 스캔 검증 통과 → 인쇄 대기열(FIFO)에 적재. 실제 인쇄는 소비자 루프가 담당한다. */
  const markQueued = useCallback(async (position: number, code: string, scannedValue: string | null) => {
    const now = new Date().toISOString();
    await supabase.from("barcode_print_items").upsert(
      {
        kind, order_id: order.id, position, code,
        status: "queued", dispatch_status: "queued", scan_sequence: position, verdict: "ok", scanned_value: scannedValue,
        expected_value: code,
        scanned_at: now, printed_at: null, test_mode: false,
        gateway_job_id: null, dispatch_started_at: null, gateway_received_at: null,
        response_code: null, retry_count: 0, error_code: null, error_detail: null,
      } as any,
      { onConflict: "kind,order_id,position" },
    );
    setSaved((prev) => ({ ...prev, [position]: { position, code, status: "queued", test_mode: false, printed_at: null, scanned_at: now, scanned_value: scannedValue, expected_value: code, verdict: "ok", scan_sequence: position, dispatch_status: "queued", retry_count: 0 } }));
  }, [kind, order.id]);

  /**
   * 스캔 검증 실패(order/mismatch/duplicate)도 서버에 기록한다.
   * 판정은 브라우저마다 따로 계산하지 않고 이 테이블 값을 읽어 그린다 → 기기별 결과 차이 제거.
   */
  const saveVerdicts = useCallback(async (rows: Array<{ at: string; barcode: string; verdict: string; position: number | null; expected?: string | null }>) => {
    const now = new Date().toISOString();
    const payload = rows
      .map((r) => {
        const pos = r.position ?? null;
        if (pos == null) return null;
        const code = expected[pos - 1]?.no;
        if (!code) return null;
        return {
          kind, order_id: order.id, position: pos, code,
          verdict: r.verdict, scanned_value: r.barcode, scanned_at: r.at || now, scan_sequence: pos,
          // 기대값은 항상 주문 상세 목록의 해당 순번 값 (판정 시점 커서 값으로 덮어쓰지 않는다)
          expected_value: code,
        };
      })
      .filter(Boolean) as any[];
    if (payload.length === 0) return;
    await supabase.from("barcode_print_items").upsert(payload, { onConflict: "kind,order_id,position" });
    setSaved((prev) => {
      const next = { ...prev };
      for (const p of payload) {
        const cur = next[p.position];
        next[p.position] = { ...(cur ?? { position: p.position, code: p.code, status: "pending", test_mode: false, printed_at: null }), verdict: p.verdict, scanned_value: p.scanned_value, scanned_at: p.scanned_at, expected_value: p.expected_value };
      }
      return next;
    });
  }, [expected, kind, order.id]);

  /** 인쇄 실패 → 대기열 선두에서 멈춤 (다음 항목으로 넘어가지 않음) */
  const haltRef = useRef(false);
  /** uncertain 진입 시각 (position → epoch ms). 게이트웨이 조회로 판정될 때까지 유지 */
  const uncertainSinceRef = useRef<Record<number, number>>({});
  const markPrintError = useCallback(async (position: number, code: string, message: string, errorCode: PfErrorCode = "GATEWAY_ERROR") => {
    haltRef.current = true;
    await supabase.from("barcode_print_items").upsert(
      { kind, order_id: order.id, position, code, status: "error", dispatch_status: "error", verdict: "print_failed", printed_at: null, error_code: errorCode, error_detail: message },
      { onConflict: "kind,order_id,position" },
    );
    setSaved((prev) => ({ ...prev, [position]: { ...prev[position], position, code, status: "error", dispatch_status: "error", error_code: errorCode, error_detail: message, test_mode: false, printed_at: null } }));
    setHalted(true);
    toast.error(`${code} · ${message}`);
  }, [kind, order.id]);

  /**
   * 전송 결과를 알 수 없는 상태(HTTP 502 / 연결 끊김 / 프록시 오류).
   * 프린터에 이미 데이터가 올라갔을 수 있으므로 실패로 확정하지 않고 `uncertain` 으로 두고
   * 게이트웨이 큐를 조회해 실제 job 존재 여부로 판정한다. 이 상태에서는 재전송하지 않는다.
   */
  const markUncertain = useCallback(async (position: number, code: string, message: string, errorCode: PfErrorCode = "GATEWAY_ERROR") => {
    haltRef.current = true;
    await supabase.from("barcode_print_items").upsert(
      { kind, order_id: order.id, position, code, status: "queued", dispatch_status: "uncertain", verdict: "ok", printed_at: null, error_code: errorCode, error_detail: message },
      { onConflict: "kind,order_id,position" },
    );
    setSaved((prev) => ({ ...prev, [position]: { ...prev[position], position, code, status: "queued", dispatch_status: "uncertain", error_code: errorCode, error_detail: message, test_mode: false, printed_at: null } }));
    setHalted(true);
    toast.warning(`${code} · ${tr("전송 결과 확인 중", "正在确认发送结果")} · ${message}`);
  }, [kind, order.id, isKo]);



  const markDone = useCallback(async (position: number, code: string, scannedValue: string | null, isTest: boolean) => {
    const now = new Date().toISOString();
    await supabase.from("barcode_print_items").upsert(
      {
        kind, order_id: order.id, position, code,
        status: "done", dispatch_status: "printed", verdict: "ok", scanned_value: scannedValue,
        scanned_at: scannedValue ? now : null, printed_at: now, test_mode: isTest,
      },
      { onConflict: "kind,order_id,position" },
    );
    setSaved((prev) => ({ ...prev, [position]: { ...prev[position], position, code, status: "done", dispatch_status: "printed", test_mode: isTest, printed_at: now } }));
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

  const sendToPrinter = useCallback(async (code: string) => {
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
    return r;
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
      if (inFlight || inFlightRef.current) return;
      inFlight = true;
      try {
        const [pf, q] = await Promise.all([pfPrinterStatus(), pfPrinterQueue()]);
        if (!alive) return;
        const cut = ts(cutoffRef.current);
        // Queue/history can stay online while the serial device is detached;
        // printer connectivity must therefore follow /status itself.
        setPrinterOffline(pf.offline);
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
          setSaved((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const item of Object.values(prev)) {
              if (!item.gateway_job_id) continue;
              const gateway = rows.find((row) => row.id === item.gateway_job_id);
              if (!gateway) continue;
              // 사용자가 대기열/버퍼를 초기화해 취소된 작업은 오류가 아니라 "다시 대기"로 되돌린다.
              const cancelled = gateway.status === "failed" && isCancelledJobError(gateway.error);
              const dispatchStatus = gateway.status === "printing"
                ? "printing"
                : cancelled ? "queued"
                : gateway.status === "failed" ? "error"
                : gateway.status === "done" && gateway.printed !== false ? "printed"
                : gateway.status === "pending" ? "waiting_for_print"
                : item.dispatch_status;


              if (dispatchStatus && dispatchStatus !== item.dispatch_status) {
                next[item.position] = {
                  ...item,
                  dispatch_status: dispatchStatus,
                  error_detail: cancelled ? undefined : gateway.error ?? item.error_detail,
                  error_code: cancelled ? undefined : item.error_code,
                };
                changed = true;
              }

            }
            return changed ? next : prev;
          });
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
      // 서버 동기화 지연으로 로컬 커서가 뒤처져 있어도 cursorRef 는 최신 값을 유지한다
      cursor: Math.max(cursor, cursorRef.current),
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
    // 실패 판정도 서버에 기록 → 모든 기기가 동일한 로그/중단 상태를 본다
    const failed = res.rows.filter((r) => r.verdict !== "ok");
    if (failed.length > 0) void saveVerdicts(failed);
    cursorRef.current = res.cursor;
    setCursor(res.cursor);
    setLastVerdict(res.lastVerdict);
    if (res.halted) setHalted(true);
    // 경고등: 불일치 시 적색 점등(유지), 통과 시 녹색 점등(0.5초 후 자동 소등)
    // — 서버 딜레이 개선(단일 요청 다중 채널)으로 녹색 플래시를 다시 사용한다.
    if (res.halted && !halted) void warnLightError();
    else if (res.rows.some((r) => r.verdict === "ok")) void warnLightOkFlash();
  }, [queue, expected, cursor, testMode, ready, markQueued, saveVerdicts, kind, halted]);


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
  haltRef.current = halted;

  const pump = useCallback(async () => {
    if (busyRef.current) return; // 이미 다른 소비자가 실행 중
    busyRef.current = true;
    try {
      // 서버 /test 는 큐 등록만 하고 즉시 응답한다. 프린터 직접 제어(run/ready 확인)는 하지 않고
      // position 순서대로 한 건씩 큐에 넣은 뒤, 진행/완료는 GET /queue 폴링으로만 확정한다.
      // 대기열이 빌 때까지 한 건씩 순차 전송 (ACK 후 다음 건)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const g = gateRef.current;
        if (!g.ready || g.testMode || g.halted || haltRef.current) break;
        // A row claimed by another tab/device is the sole active dispatcher.
        // 앞선 건이 실제 0x40 인쇄 완료로 확정되기 전에는 다음 건을 보내지 않는다.
        // uncertain(결과 미확인) 건이 남아 있어도 판정 전까지는 전송을 멈춘다.
        // 서버 큐가 접수 순서를 보존하므로, 앞 건의 물리 인쇄를 기다리지 않고 순서대로 큐에 넣는다.
        // 다만 결과 미확인(uncertain) 건이 있으면 판정 전까지 멈춘다.
        if (Object.values(savedRef.current).some((s) => s.status === "queued" &&
          (s.dispatch_status === "dispatching" || s.dispatch_status === "uncertain"))) break;
        const next = Object.values(savedRef.current)
          .filter((s) => s.status === "queued" && (s.dispatch_status ?? "queued") === "queued" && !dispatchedRef.current.has(s.position))
          .sort((a, b) => a.position - b.position)[0];
        if (!next) break;

        // DB compare-and-set claim: 다른 탭/기기가 이미 가져간 작업은 전송하지 않는다.
        const dispatchStartedAt = new Date().toISOString();
        const { data: claimed, error: claimError } = await supabase
          .from("barcode_print_items")
          .update({ dispatch_status: "dispatching", dispatch_started_at: dispatchStartedAt, error_code: null, error_detail: null })
          .eq("kind", kind).eq("order_id", order.id).eq("position", next.position)
          .eq("dispatch_status", "queued")
          .select("position")
          .maybeSingle();
        if (claimError || !claimed) {
          await loadSaved();
          break;
        }
        dispatchedRef.current.add(next.position);
        setSaved((prev) => ({ ...prev, [next.position]: { ...prev[next.position], dispatch_status: "dispatching" } }));
        const seq = ++dispatchSeqRef.current;
        const dispatchAt = Date.now();
        setPrintingPos(next.position);
        setInFlightCount(1);
        setDispatchLog((prev) => [
          { seq, scanSequence: next.scan_sequence ?? next.position, position: next.position, code: next.code, scanAt: next.scanned_at ?? null, dispatchAt, ackAt: null, ok: null, gatewayJobId: null, printedAt: null, error: null, errorCode: null, responseCode: null, retryCount: 0, runState: "READY", readyAt: new Date().toISOString(), serialSendAt: null, serialResponseAt: null, proxyUpstreamMs: null },
          ...prev,
        ].slice(0, 200));

        const r = await sendToPrinter(printValueRef.current(next.code));
        const ackAt = Date.now();
        setDispatchLog((prev) => prev.map((row) => (row.seq === seq
          ? { ...row, ackAt, ok: r.ok, gatewayJobId: r.id ?? null, error: r.ok ? null : r.error ?? "send failed", errorCode: r.errorCode ?? null, responseCode: r.responseCode ?? null, retryCount: r.retryCount, serialSendAt: r.serialSendAt ?? null, serialResponseAt: r.serialResponseAt ?? null, proxyUpstreamMs: r.timing?.proxyUpstreamMs ?? null }
          : row)));

        if (r.ok) {
          const receivedAt = new Date().toISOString();
          await supabase.from("barcode_print_items").update({
            dispatch_status: r.printed ? "printed" : "waiting_for_print",
            gateway_job_id: r.id ?? null,
            gateway_received_at: receivedAt,
            printer_run_state: "READY",
            printer_ready_at: receivedAt,
            serial_send_at: r.serialSendAt ?? null,
            serial_response_at: r.serialResponseAt ?? null,
            response_code: r.responseCode ?? null,
            retry_count: r.retryCount,
            error_code: null,
            error_detail: null,
          }).eq("kind", kind).eq("order_id", order.id).eq("position", next.position);
          setSaved((prev) => ({ ...prev, [next.position]: { ...prev[next.position], dispatch_status: r.printed ? "printed" : "waiting_for_print", gateway_job_id: r.id ?? null, retry_count: r.retryCount } }));
          // printed=true → 이미 물리 인쇄 확인. null/false 는 "버퍼 접수됨"이며 오류가 아니다.
          if (r.printed) await markDone(next.position, next.code, null, false);
        } else {
          // HTTP 실패 = 인쇄 실패가 아니다. 전송 도달 여부를 알 수 없는 오류(502/연결 끊김/게이트웨이 오류)는
          // uncertain 으로 두고 게이트웨이 job 조회로 판정한다. 절대 같은 데이터를 자동 재전송하지 않는다.
          const uncertainCodes: PfErrorCode[] = ["GATEWAY_OFFLINE", "GATEWAY_ERROR", "PRINTER_RESPONSE_TIMEOUT"];
          if (r.errorCode && uncertainCodes.includes(r.errorCode)) {
            uncertainSinceRef.current[next.position] = Date.now();
            await markUncertain(next.position, next.code, r.error ?? "gateway unreachable", r.errorCode);
          } else {
            dispatchedRef.current.delete(next.position); // 프린터에 도달하지 않은 확정 실패만 재시도 가능
            await markPrintError(next.position, next.code, r.error ?? "printer send failed", r.errorCode);
          }
          break; // Fail-fast: 이후 항목은 전송하지 않는다
        }
      }
    } finally {
      busyRef.current = false;
      setInFlightCount(0);
      setPrintingPos(null);
      if (!haltRef.current && Object.values(savedRef.current).some((s) => s.status === "queued" && (s.dispatch_status ?? "queued") === "queued" && !dispatchedRef.current.has(s.position))) {
        setDispatchWake((n) => n + 1);
      }
    }
  }, [sendToPrinter, markDone, markPrintError, markUncertain, kind, order.id, loadSaved]);

  /**
   * uncertain 판정 — 게이트웨이 큐/이력(GET /queue 는 done·failed 까지 함께 내려준다)을 조회해
   * 실제 job 존재 여부로 결론짓는다. 판정 우선순위는 gateway_job_id → 바코드 텍스트.
   * - job 이 있으면 이미 프린터로 전송된 것 → 재전송하지 않고 waiting_for_print/printed 로 승격
   * - job 이 failed 면 확정 실패
   * - 게이트웨이가 복구된 뒤에도 30초간 job 이 없으면 미도달로 보고 재시도 가능한 error 로 확정
   * 시리얼 통신 내역은 게이트웨이가 노출하지 않으므로 success/fail 판정만 사용한다.
   */
  useEffect(() => {
    const pending = Object.values(saved).filter((s) => s.dispatch_status === "uncertain");
    if (pending.length === 0) return;
    for (const s of pending) {
      const pv = printValueRef.current(s.code);
      const job = (s.gateway_job_id ? jobs.find((j) => j.id === s.gateway_job_id) : undefined)
        ?? jobs.find((j) => norm(j.barcode) === norm(pv));

      if (job) {
        if (job.status === "failed" && !isCancelledJobError(job.error)) {
          void markPrintError(s.position, s.code, job.error ?? "gateway job failed", "GATEWAY_ERROR");
          continue;
        }
        // 초기화로 취소된 작업은 오류가 아니라 다시 대기 상태로 되돌린다.
        const dispatchStatus = job.status === "failed" ? "queued"
          : job.status === "printing" ? "printing"
          : job.status === "done" && job.printed !== false ? "printed" : "waiting_for_print";


        void supabase.from("barcode_print_items")
          .update({ dispatch_status: dispatchStatus, gateway_job_id: job.id, error_code: null, error_detail: null })
          .eq("kind", kind).eq("order_id", order.id).eq("position", s.position);
        setSaved((prev) => ({ ...prev, [s.position]: { ...prev[s.position], dispatch_status: dispatchStatus, gateway_job_id: job.id, error_code: undefined, error_detail: undefined } }));
        delete uncertainSinceRef.current[s.position];
        continue;
      }
      // 게이트웨이가 아직 오프라인이면 판정을 미룬다 (조회 불가 = 실패 아님)
      if (printerOffline) continue;
      const since = uncertainSinceRef.current[s.position] ?? Date.now();
      uncertainSinceRef.current[s.position] = since;
      if (Date.now() - since > 30000) {
        delete uncertainSinceRef.current[s.position];
        dispatchedRef.current.delete(s.position);
        void markPrintError(s.position, s.code, s.error_detail ?? "gateway job not found (미도달)", "GATEWAY_ERROR");
      }
    }
  }, [saved, jobs, printerOffline, markPrintError, kind, order.id]);

  // 상태가 바뀔 때마다 디스패처를 깨운다 (실행 중이면 pump 가 즉시 반환하므로 중복 없음)
  useEffect(() => { void pump(); }, [saved, ready, testMode, halted, dispatchWake, pump]);

  // Gateway ACK 뒤 비동기 인쇄가 실패한 경우에도 즉시 중단한다.
  // 단, 사용자가 대기열/버퍼를 초기화해 취소된 작업은 오류로 보지 않는다.
  useEffect(() => {
    if (halted) return;
    const failed = Object.values(saved).find((item) => item.gateway_job_id && item.status === "queued" &&
      jobs.some((job) => job.id === item.gateway_job_id && job.status === "failed" && !isCancelledJobError(job.error)));
    if (!failed) return;
    const job = jobs.find((row) => row.id === failed.gateway_job_id);
    void markPrintError(failed.position, failed.code, job?.error ?? "Gateway print job failed", "GATEWAY_ERROR");
  }, [jobs, saved, halted, markPrintError]);


  // ── 인쇄 완료 확인(큐 폴링 결과 반영) ───────────────────────────────
  // 접수만 된 항목(queued & 전송 완료)은 프린터 큐/완료 이벤트에서 실제 인쇄완료가
  // 확인되는 시점에 비로소 done 으로 확정한다.
  useEffect(() => {
    const pendingConfirm = Object.values(saved).filter(
      (s) => s.status === "queued" && (dispatchedRef.current.has(s.position) || s.dispatch_status === "accepted" ||
        s.dispatch_status === "uncertain" || s.dispatch_status === "waiting_for_print" || s.dispatch_status === "printing"),
    );
    if (pendingConfirm.length === 0) return;
    for (const s of pendingConfirm) {
      const pv = printValueRef.current(s.code);
      const codes = [s.code, pv];
      // 초기화 이전(또는 이번 스캔 이전)의 완료 근거로 새 작업을 완료 처리하지 않는다.
      const notBefore = Math.max(ts(cutoffRef.current), ts(s.scanned_at ?? null));
      const job = jobs.find((j) => (s.gateway_job_id && j.id === s.gateway_job_id)
        || (!s.gateway_job_id && codes.some((c) => norm(c) === norm(j.barcode)) && ts(j.enqueued_at) >= notBefore)) ?? null;
      const at = resolvePrintedAt({ codes, completeEvents, printedAcc, job, notBefore });
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
      dispatch_status: "queued", scan_sequence: e.position,
      scanned_at: now, printed_at: null, test_mode: false, gateway_job_id: null,
      retry_count: 0, error_code: null, error_detail: null,
    }));
    const { error } = await supabase.from("barcode_print_items").upsert(rows, { onConflict: "kind,order_id,position" });
    if (error) { toast.error(error.message); return; }
    setSaved((prev) => {
      const next = { ...prev };
      for (const e of targets) next[e.position] = { position: e.position, code: e.no, status: "queued", test_mode: false, printed_at: null, scanned_at: now, scan_sequence: e.position, dispatch_status: "queued", retry_count: 0 };
      return next;
    });
    for (const e of targets) seenRef.current.add(norm(e.no));
    setCursor(Math.max(cursor, ...targets.map((t) => t.position)));
    haltRef.current = false;
    setHalted(false);
    toast.success(`${tr("인쇄 대기열에 추가했습니다", "已加入打印队列")} · ${targets.length}`);
  }, [expected, saved, kind, order.id, cursor, isKo]);

  /**
   * 인쇄 대기열 초기화 — 프린터 서버 FIFO 큐(pending)까지 함께 취소하고,
   * 앱 측 대기(queued)/실패(error) 항목을 제거한다. 완료 기록은 유지.
   */
  const clearQueue = useCallback(async () => {
    // 버퍼 클리어: pending 취소 + 프린터 물리 버퍼(processing)까지 전부 삭제
    const cleared = await pfPrinterBufferClear();
    const targets = Object.values(saved).filter((s) => s.status === "queued" || s.status === "error");
    if (targets.length === 0 && cleared.cancelledPending === 0 && cleared.failedProcessing === 0) {
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
    haltRef.current = false;
    setHalted(false);
    toast.success(
      `${tr("인쇄 대기열을 초기화했습니다", "打印队列已清空")} · ${tr("앱", "应用")} ${targets.length} · ${tr("프린터", "打印机")} ${cleared.ok ? cleared.cancelledPending + cleared.failedProcessing : "-"}`,
    );
  }, [saved, kind, order.id, isKo]);







  /** 실패한 항목을 다시 대기열로 되돌리고 인쇄 재개 */
  const retryFailed = async () => {
    const bad = Object.values(saved).filter((s) => s.status === "error");
    for (const b of bad) {
      await supabase.from("barcode_print_items")
        .update({ status: "queued", dispatch_status: "queued", verdict: "ok", gateway_job_id: null, dispatch_started_at: null, gateway_received_at: null, response_code: null, error_code: null, error_detail: null })
        .eq("kind", kind).eq("order_id", order.id).eq("position", b.position);
      dispatchedRef.current.delete(b.position);
    }
    setSaved((prev) => {
      const next = { ...prev };
      for (const b of bad) next[b.position] = { ...b, status: "queued", dispatch_status: "queued", gateway_job_id: null, error_code: null, error_detail: null };
      return next;
    });
    haltRef.current = false;
    haltRef.current = false;
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
    cursorRef.current = 0;
    setCursor(0);
    setSaved({});
    setLastVerdict(null);
    setHalted(false);
    // 초기화 직후 기존 게이트웨이 이력이 다시 검증되지 않도록 프라이밍을 다시 수행
    primedRef.current = false;
    processedRef.current = new Set();
    dispatchedRef.current = new Set();
    setDispatchLog([]);
    lastCodeRef.current = "";
    await loadSaved();
    toast.success(tr("작업이 초기화되었습니다", "作业已复位"));
  };



  // 중간부터 다시 작업 — 해당 순번부터 미완료 처리
  const resumeFrom = async (position: number) => {
    await supabase
      .from("barcode_print_items")
      .update({ status: "pending", dispatch_status: "queued", verdict: null, scanned_value: null, expected_value: null, scanned_at: null, printed_at: null, gateway_job_id: null, dispatch_started_at: null, gateway_received_at: null, error_code: null, error_detail: null } as any)
      .eq("kind", kind).eq("order_id", order.id).gte("position", position);
    for (const p of Array.from(dispatchedRef.current)) if (p >= position) dispatchedRef.current.delete(p);
    haltRef.current = false;
    setHalted(false);
    setLastVerdict(null);
    lastCodeRef.current = "";
    // 커서/스캔 이력을 서버 상태 기준으로 다시 계산해야 하므로 로컬 누적을 비운다
    cursorRef.current = 0;
    seenRef.current = new Set();
    await loadSaved();
    toast.success(tr(`${position}번부터 다시 작업합니다`, `从第 ${position} 项重新作业`));
  };

  // 개별 재작업(스캔 없이 즉시 인쇄)
  const reprint = async (position: number, code: string) => {
    const r = await sendToPrinter(printValueRef.current(code));
    if (r.ok && r.printed) await markDone(position, code, null, testMode);
    toast[r.ok ? "success" : "error"](
      r.ok ? tr("인쇄 요청을 보냈습니다", "已发送打印请求")
           : `${tr("인쇄 전송 실패", "打印发送失败")} — ${r.error ?? ""}`,
    );
  };

  // 테스트 모드 순차 인쇄
  // 물리 인쇄 완료까지 기다리지 않는다 — 서버 큐에 정상 등록(accepted / status=pending|processing)되면
  // 즉시 다음 항목으로 넘어가고, 실제 완료는 큐 폴링(waiting_for_print → printed)으로 확정한다.
  const printNextTest = async () => {
    const target = expected[cursor];
    if (!target) return;
    const r = await sendToPrinter(printValueRef.current(target.no));
    if (r.ok) {
      if (r.printed) {
        await markDone(target.position, target.no, null, true);
      } else {
        const now = new Date().toISOString();
        await supabase.from("barcode_print_items").upsert(
          {
            kind, order_id: order.id, position: target.position, code: target.no,
            status: "queued", dispatch_status: "waiting_for_print", scan_sequence: target.position,
            verdict: "ok", scanned_value: null, scanned_at: now, printed_at: null, test_mode: true,
            gateway_job_id: r.id ?? null, gateway_received_at: now,
            response_code: r.responseCode ?? null, retry_count: r.retryCount,
            error_code: null, error_detail: null,
          },
          { onConflict: "kind,order_id,position" },
        );
        setSaved((prev) => ({
          ...prev,
          [target.position]: {
            ...prev[target.position], position: target.position, code: target.no, status: "queued",
            dispatch_status: "waiting_for_print", gateway_job_id: r.id ?? null, test_mode: true,
            printed_at: null, scanned_at: now, scan_sequence: target.position, retry_count: r.retryCount,
          },
        }));
      }
      setCursor((c) => c + 1);
      seenRef.current.add(norm(target.no));
    }
    toast[r.ok ? "success" : "error"](
      r.ok ? `${target.no} ${tr("인쇄 대기열 등록", "已加入打印队列")}`
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
    cancelled: { ko: "초기화로 취소", zh: "因清空而取消", cls: "text-muted-foreground" },
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
  type QueueState = "queued" | "dispatching" | "uncertain" | "accepted" | "waiting_for_print" | "printing" | "printed" | "error";
  const queueStateMeta: Record<QueueState, { ko: string; zh: string; cls: string }> = {
    queued: { ko: "대기", zh: "等待", cls: "text-muted-foreground" },
    dispatching: { ko: "Gateway 전송 중", zh: "正在发送到网关", cls: "text-primary" },
    uncertain: { ko: "전송 결과 확인 중 (재전송 안 함)", zh: "确认发送结果中（不重发）", cls: "text-orange-500" },
    accepted: { ko: "Gateway 접수 완료", zh: "网关已接收", cls: "text-amber-500" },
    waiting_for_print: { ko: "인쇄 대기 (물체 감지 대기)", zh: "等待打印（等待物体）", cls: "text-amber-500" },
    printing: { ko: "프린터 인쇄 중", zh: "打印机打印中", cls: "text-primary" },
    printed: { ko: "실제 출력 완료", zh: "实际打印完成", cls: "text-emerald-500" },
    error: { ko: "인쇄 실패 · 작업 중단", zh: "打印失败 · 作业中断", cls: "text-destructive" },
  };
  const posByPrintValue: Record<string, number> = {};
  for (const e of expected) {
    posByPrintValue[norm(e.no)] = e.position;
    posByPrintValue[norm(e.base)] = e.position;
    if (e.cardNo) posByPrintValue[norm(e.cardNo)] = e.position;
  }
  const queueRows: Array<{ key: string; position: number | null; code: string; state: QueueState }> = Object.values(saved)
    .filter((s) => s.status === "queued" || s.status === "error")
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      key: `item-${s.position}`,
      position: s.position,
      code: printValueRef.current(s.code),
      state: (s.status === "error" ? "error" : s.dispatch_status ?? "queued") as QueueState,
    }));
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
      return { e, s: saved[e.position], job, event, at: resolvePrintedAt({ codes, completeEvents, printedAcc, job, notBefore: cutoffRef.current }) };
    })
    .filter((r) => !!r.at)
    .sort((a, b) => a.e.position - b.e.position);
  const confirmedPrinted = printedItems.length;




  // 초기화(버퍼 클리어)로 취소된 작업은 실패 집계에서 제외한다.
  const failedJobs = jobs.filter((j) => j.status === "failed" && !isCancelledJobError(j.error)).length;

  const lastJob = jobs[0] ?? null;
  const lastJobCancelled = lastJob?.status === "failed" && isCancelledJobError(lastJob.error);
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
                {lastJob?.error && !lastJobCancelled && <p className="text-[11px] text-destructive truncate">{lastJob.error}</p>}
                {lastJobCancelled && <p className="text-[11px] text-muted-foreground truncate">{tr("버퍼 초기화로 취소됨", "因清空缓冲而取消")}</p>}
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
                  <Button size="sm" className="flex-1 gap-1 h-9" onClick={() => { haltRef.current = false; void (errorCount > 0 ? retryFailed() : Promise.resolve(setHalted(false))); }}>
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
                <span className="text-xs font-normal text-muted-foreground">({queueRows.length})</span>
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
                  : rawTab === "printer"
                    ? tr("프린터로 실제 전송한 명령 · 최근 100건", "实际发送至打印机的指令 · 最近100条")
                    : tr("전송 순서 추적 (밀리초) · 최근 200건", "发送顺序追踪（毫秒）· 最近200条")}
              </span>
            </CardTitle>
            <div className="flex gap-1 pt-2">
              <Button size="sm" variant={rawTab === "scanner" ? "default" : "outline"} onClick={() => setRawTab("scanner")} className="gap-1">
                <ScanLine className="w-3.5 h-3.5" />{tr("스캐너", "扫描仪")}
              </Button>
              <Button size="sm" variant={rawTab === "printer" ? "default" : "outline"} onClick={() => setRawTab("printer")} className="gap-1">
                <Printer className="w-3.5 h-3.5" />{tr("프린터", "打印机")}
              </Button>
              <Button size="sm" variant={rawTab === "dispatch" ? "default" : "outline"} onClick={() => setRawTab("dispatch")} className="gap-1">
                <Printer className="w-3.5 h-3.5" />{tr("전송 순서", "发送顺序")}
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
              ) : rawTab === "printer" ? (
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
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 whitespace-nowrap">scan seq</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">pos</th>
                      <th className="px-2 py-1.5">{tr("바코드", "条码")}</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">dispatch</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">ACK</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">ms</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">gateway job</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">run / ready</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">HTTP / retry</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">printed (0x40)</th>
                      <th className="px-2 py-1.5 whitespace-nowrap">error code</th>
                      <th className="px-2 py-1.5">{tr("결과", "结果")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatchLog.length === 0 ? (
                      <tr><td colSpan={12} className="px-2 py-6 text-center text-muted-foreground">{tr("전송 기록이 없습니다", "暂无发送记录")}</td></tr>
                    ) : dispatchLog.map((d) => {
                      const fmt = (ms: number | null) =>
                        ms == null ? "-" : `${new Date(ms).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN", { hour12: false })}.${String(ms % 1000).padStart(3, "0")}`;
                      return (
                        <tr key={d.seq} className={`border-t ${d.ok === false ? "bg-destructive/5" : ""}`}>
                          <td className="px-2 py-1.5 tabular-nums">{d.scanSequence ?? "-"}</td>
                          <td className="px-2 py-1.5 tabular-nums">{d.position < 0 ? "-" : d.position}</td>
                          <td className="px-2 py-1.5 font-mono break-all">{d.code}</td>
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap">{fmt(d.dispatchAt)}</td>
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap">{fmt(d.ackAt)}</td>
                          <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">
                            {d.ackAt ? d.ackAt - d.dispatchAt : "-"}
                            {d.proxyUpstreamMs != null && <span className="text-muted-foreground"> / gw {d.proxyUpstreamMs}</span>}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-[10px] break-all">{d.gatewayJobId ?? "-"}</td>
                          <td className="px-2 py-1.5 text-[10px] whitespace-nowrap">{d.runState ?? "-"} / {d.readyAt ? new Date(d.readyAt).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN", { hour12: false }) : "-"}</td>
                          <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{d.responseCode ?? "-"} / {d.retryCount}</td>
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap">
                            {d.printedAt ? new Date(d.printedAt).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN", { hour12: false }) : "-"}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-[10px] text-destructive">{d.errorCode ?? "-"}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {d.ok == null ? <span className="text-muted-foreground">{tr("전송 중", "发送中")}</span>
                              : d.ok ? <span className="text-emerald-500">accepted</span>
                              : <span className="text-destructive break-all">{d.error}</span>}
                          </td>
                        </tr>
                      );
                    })}
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
