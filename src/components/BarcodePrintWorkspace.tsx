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
import { warnLightOkFlash, warnLightError, warnLight2OkFlash } from "@/lib/warning-light";
import { pfPrint, pfPrinterStatus } from "@/lib/pf-printer";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ScanLine, Printer, RotateCcw, CheckCircle2, XCircle, Wifi, WifiOff,
  ChevronLeft, AlertTriangle, Loader2, Play, Pause, SkipForward, FlaskConical,
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
  const [printerLog, setPrinterLog] = useState<PrinterSendLog[]>([]);
  const [rawTab, setRawTab] = useState<"scanner" | "printer">("scanner");

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
  const expected = useMemo(() => {
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
        // 파이프가 있으면 NDEF 원문이므로 두 번째 세그먼트만 사용
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

  const sendToPrinter = useCallback(async (code: string): Promise<{ ok: boolean; error?: string }> => {
    const payload = String(code ?? "").slice(0, 200);
    const record = (ok: boolean, error: string | null) => {
      setPrinterLog((prev) => [
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), code, payload, ok, error },
        ...prev,
      ].slice(0, 100));
    };
    // PF 프린터 인쇄 (POST /api/v1/pf-printer/test)
    const r = await pfPrint(payload);
    record(r.ok, r.ok ? null : r.error ?? null);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }, []);




  // 스캐너 상태 + 인쇄 대기열 폴링
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [sRes, pf, hRes] = await Promise.all([
          proxyFetch("/api/v1/scan/status"),
          pfPrinterStatus(),
          proxyFetch("/api/v1/scan/history"),
        ]);
        const s: any = await sRes.json();
        if (!alive) return;
        if (!sRes.ok || "upstream_status" in s) { setOffline(true); }
        else { setOffline(false); setStatus(s as ScanStatus); }
        const cut = ts(cutoffRef.current);
        // PF 프린터 상태 (잉크/버퍼) — 인쇄 대기 건수는 프린터 버퍼 기준
        setPrinterOffline(pf.offline);
        setPendingCount(pf.buffer_count ?? 0);
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
        if (alive) { setOffline(true); setPrinterOffline(true); }
      } finally {
        inFlight = false;
      }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 새 스캔 이벤트 큐 처리 → 순서/정보 검증 (테스트 모드에서는 스캔 무시)
  useEffect(() => {
    if (queue.length === 0) return;
    if (!ready || testMode) { setQueue([]); return; }
    const events = queue;
    setQueue([]);

    let c = cursor;
    let lastV: Verdict | null = null;
    let halt = false;
    const rows: LogRow[] = [];

    for (const ev of events) {
      const code = norm(ev.barcode);
      if (!code) continue;
      // 같은 값이 연속으로 이중 스캔된 경우 1건으로만 반영 (직전 값과 동일하면 무시)
      if (code === lastCodeRef.current) continue;
      lastCodeRef.current = code;

      let verdict: Verdict = "mismatch";
      let position: number | null = null;
      const target = expected[c];

      if (seenRef.current.has(code)) {
        verdict = "duplicate";
        position = expected.findIndex((e) => e.keys.includes(code)) + 1 || null;
      } else if (target && target.keys.includes(code)) {
        verdict = "ok";
        position = target.position;
        seenRef.current.add(code);
        c += 1;
        // 생산자(스캔)는 검증 후 인쇄 대기열에 적재만 한다 — 실제 인쇄는 소비자 루프가 순서대로 처리
        void markQueued(target.position, target.no, ev.barcode);
      } else {
        const found = expected.findIndex((e) => e.keys.includes(code));
        if (found >= 0) { verdict = "order"; position = found + 1; }
      }

      lastV = verdict;
      if (verdict !== "ok") halt = true;
      rows.push({ at: ev.scanned_at, barcode: ev.barcode, verdict, expected: target?.no ?? null, position });
    }

    if (rows.length === 0) return;
    setCursor(c);
    setLastVerdict(lastV);
    if (halt) setHalted(true);
    // 1번 경고등: 순서 일치 → 녹색 0.5초 점멸 / 불일치 → 빨강 점등 유지
    if (kind === "card") {
      if (halt) void warnLightError();
      else if (lastV === "ok") {
        void warnLightOkFlash();
        // 2번 경고등: 검증 일치 시 녹색 0.5초 점등
        void warnLight2OkFlash();
      }
    }
    setLog((prev) => [...rows.slice().reverse(), ...prev].slice(0, 100));
  }, [queue, expected, cursor, testMode, ready, markQueued, kind]);


  // ── 소비자(인쇄) 처리 ─────────────────────────────────────────────
  // PF 프린터(/api/v1/pf-printer)는 스캔 이벤트에 자동 연결되어 있지 않다.
  // 검증을 통과해 queued 상태가 된 항목을 대기열 선두부터 "한 건씩" 전송하고,
  // 전송 결과를 저장한 뒤 다음 건을 이어서 처리한다(FIFO, 순서 보장).
  const printingRef = useRef(false);
  const [printTick, setPrintTick] = useState(0);
  const [printingPos, setPrintingPos] = useState<number | null>(null);
  useEffect(() => {
    if (!ready || testMode || printingRef.current) return;
    const pending = Object.values(saved)
      .filter((s) => s.status === "queued" || s.status === "error")
      .sort((a, b) => a.position - b.position);
    const head = pending[0];
    // 선두가 인쇄 실패 상태면 순서 보장을 위해 뒤 항목을 먼저 인쇄하지 않는다.
    if (!head || head.status !== "queued") { setPrintingPos(null); return; }
    printingRef.current = true;
    setPrintingPos(head.position);
    void (async () => {
      try {
        const r = await sendToPrinter(printValueRef.current(head.code));
        if (r.ok) await markDone(head.position, head.code, null, false);
        else await markPrintError(head.position, head.code, r.error ?? "printer send failed");
      } finally {
        printingRef.current = false;
        setPrintingPos(null);
        setPrintTick((t) => t + 1); // 다음 대기 건 이어서 처리
      }
    })();
  }, [saved, printTick, ready, testMode, sendToPrinter, markDone, markPrintError]);




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
  const doneJobs = jobs.filter((j) => j.status === "done");
  const waitingJobs = jobs.filter((j) => j.status !== "done");
  const printedJobs = doneJobs.length;
  // 인쇄 완료 목록 = 이 주문에서 실제 검증 후 인쇄 처리된 항목 (초기화 시 함께 지워짐)
  // 게이트웨이 인쇄 대기열에서 바코드별 최종 상태 조회용 맵
  const jobByCode: Record<string, PrintJob> = {};
  for (const j of jobs) {
    const k = norm(j.barcode);
    const prev = jobByCode[k];
    if (!prev || ts(j.printed_at ?? j.enqueued_at) >= ts(prev.printed_at ?? prev.enqueued_at)) jobByCode[k] = j;
  }
  const printedItems = expected
    .map((e) => ({ e, s: saved[e.position], job: jobByCode[norm(e.no)] ?? null }))
    .filter((r) => r.s?.status === "done" && r.s?.printed_at)
    .sort((a, b) => a.e.position - b.e.position);



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
              {offline || !status?.connected ? (
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

          <Card className={printerOffline ? "border-destructive" : ""}>
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
              {printerOffline ? (
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
                  const done = rec?.status === "done";
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

          {/* 인쇄 대기열 (서버 저장 · FIFO) */}
          <Card className={errorCount > 0 ? "border-destructive" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Printer className="w-4 h-4" />{tr("인쇄 대기열", "打印队列")}
                <span className="text-xs font-normal text-muted-foreground">({queueItems.length})</span>
              </CardTitle>
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
                    {queueItems.length === 0 ? (
                      <tr><td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">{tr("대기 중인 인쇄 작업이 없습니다", "暂无待打印作业")}</td></tr>
                    ) : queueItems.map((s) => (
                      <tr key={s.position} className={`border-t ${s.status === "error" ? "bg-destructive/5" : ""}`}>
                        <td className="px-2 py-1.5 tabular-nums">{s.position}</td>
                        <td className="px-2 py-1.5 font-mono break-all">{printValueRef.current(s.code)}</td>
                        <td className={`px-2 py-1.5 font-medium ${s.status === "error" ? "text-destructive" : printingPos === s.position ? "text-primary" : "text-muted-foreground"}`}>
                          {s.status === "error"
                            ? tr("인쇄 실패 · 작업 중단", "打印失败 · 作业中断")
                            : printingPos === s.position ? tr("전송 중", "发送中") : tr("대기", "等待")}
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
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-2 py-1.5">{tr("순번", "序号")}</th>
                      <th className="px-2 py-1.5">{tr("바코드", "条码")}</th>
                      <th className="px-2 py-1.5">{tr("게이트웨이 전송", "网关发送")}</th>
                      <th className="px-2 py-1.5">{tr("프린터 전달", "送达打印机")}</th>

                      <th className="px-2 py-1.5">{tr("인쇄 시각", "打印时间")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printedItems.length === 0 ? (
                      <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">{tr("인쇄 완료 기록이 없습니다", "暂无打印完成记录")}</td></tr>
                    ) : printedItems.map(({ e, s, job }) => (
                      <tr key={e.position} className="border-t">
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{e.position}</td>
                        <td className="px-2 py-1.5 font-mono break-all">
                          {e.no}
                          {s?.test_mode && <span className="ml-1 text-[10px] text-amber-500">TEST</span>}
                        </td>
                        <td className="px-2 py-1.5 text-emerald-500">{tr("전송됨", "已发送")}</td>
                        <td className="px-2 py-1.5">
                          {job?.status === "done" ? (
                            <span className="text-emerald-500">{tr("전달됨", "已送达")}</span>
                          ) : job?.status === "failed" ? (
                            <span className="text-destructive">{tr("실패", "失败")}</span>
                          ) : job ? (
                            <span className="text-primary">{tr("전달 중", "送达中")}</span>
                          ) : (
                            <span className="text-muted-foreground">{tr("확인 불가", "无法确认")}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {new Date(s!.printed_at as string).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}
                        </td>

                      </tr>
                    ))}

                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {tr(
                  "※ '전달됨'은 게이트웨이가 프린터로 명령 전송을 마쳤다는 뜻입니다. 프린터에 실제 출력 완료 신호를 되돌려주는 기능이 없어, 용지 없음·라벨 걸림 등 물리적 실패는 화면에서 확인할 수 없습니다.",
                  "※ '已送达' 表示网关已将指令发送至打印机。打印机不会返回实际打印完成信号，因此缺纸、卡标签等物理故障无法在界面上确认。"
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
