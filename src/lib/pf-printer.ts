/**
 * PF 시리즈 잉크젯 프린터 (게이트웨이 /api/v1/pf-printer/*) 클라이언트.
 *
 * 백엔드 API는 2026-08 개정으로 단일 버전(/api/v1)으로 통합되었다. 구형 /api/v2/* 및
 * /api/v1/print/* 경로는 더 이상 존재하지 않으므로 모든 인쇄는 이 모듈을 사용한다.
 * - POST /api/v1/pf-printer/test   값 전송(0x11) + 인쇄 트리거(0x21) 접수 (큐 job id 반환)
 * - GET  /api/v1/pf-printer/status 잉크 잔량 / 버퍼 대기 건수
 * - POST /api/v1/pf-printer/run    Run(喷印启动) 모드 전환 — /test 는 Run 모드에서만 동작
 * - POST /api/v1/pf-printer/stop   Stop 모드 전환
 *
 * 서버는 /test·/run·/stop·/status 를 하나의 FIFO 큐로 직렬화하므로 동시 호출이 안전하다.
 *
 * 서버 개정(2026-09, 인쇄 완료 버그 수정):
 * - /test 응답은 "프린터 버퍼에 접수됨" 시점에 즉시 온다 — 물리 인쇄 완료를 기다리지 않는다.
 * - 응답의 printed=true 면 그 시점에 이미 물리 인쇄까지 확인된 것(프린터가 idle이던 경우).
 *   null 이면 버퍼에서 대기 중인 정상 상태이며, 응답의 id 로 GET /queue 를 폴링해
 *   status="done" && printed=true 가 됐는지 확인한다.
 *
 * 스캔 이벤트(MQTT)와 인쇄는 서버에서 자동 연결되어 있지 않다 — 프론트가 직접 /test 를 호출한다.
 * 프린터가 Stop 상태이거나 템플릿 편집 후 Run 이 풀리면 /test 가 409(NAK)를 반환한다.
 * 이 경우 자동으로 /run 을 호출한 뒤 1회 재시도한다.
 */


const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * 서버는 프린터 통신을 내부 FIFO 큐로 직렬화한다(/test·/run·/stop·/status 공유).
 * 동시에 여러 건을 보내도 안전하지만, 자기 차례가 와야 응답이 오므로 인쇄 요청은
 * 넉넉한 타임아웃(기본 30초)을 준다. 상태 조회는 짧게(5초) 유지한다.
 */
export function pfFetch(path: string, init?: RequestInit, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(`${PROXY_BASE}${path}`, {
    ...init,
    signal: init?.signal ?? controller.signal,
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  }).finally(() => window.clearTimeout(timeout));
}


/** 게이트웨이 에러 응답(FastAPI detail 배열/문자열 모두)에서 사람이 읽을 메시지를 뽑는다. */
export function pfErrorText(j: any, status: number): string {
  const d = j?.detail;
  const base = typeof d === "string"
    ? d
    : Array.isArray(d) ? d.map((x: any) => x?.msg ?? String(x)).join(", ") : "";
  const hint =
    status === 409 ? "프린터 NAK (Run 모드 아님 / var length 불일치)"
    : status === 503 ? "프린터 시리얼 포트에 연결할 수 없음"
    : status === 502 ? "프린터 통신 오류"
    : status === 422 ? "값이 비었거나 200자를 초과함"
    : `HTTP ${status}`;
  return base || hint;
}

export type PfStatus = { ink_percent: number | null; buffer_count: number | null; offline: boolean };

export async function pfPrinterStatus(): Promise<PfStatus> {
  try {
    const res = await pfFetch("/api/v1/pf-printer/status", undefined, 8000);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || "upstream_status" in (j ?? {})) return { ink_percent: null, buffer_count: null, offline: true };
    return {
      ink_percent: typeof j?.ink_percent === "number" ? j.ink_percent : null,
      buffer_count: typeof j?.buffer_count === "number" ? j.buffer_count : null,
      offline: false,
    };
  } catch {
    return { ink_percent: null, buffer_count: null, offline: true };
  }
}

async function pfMode(mode: "run" | "stop"): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await pfFetch(`/api/v1/pf-printer/${mode}`, { method: "POST", body: "{}" }, 20000);
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.accepted) return { ok: true };
    return { ok: false, error: pfErrorText(j, res.status) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const pfPrinterRun = () => pfMode("run");
export const pfPrinterStop = () => pfMode("stop");

export type PfQueueJob = {
  id: string;
  kind: "print" | "run" | "stop" | "status";
  text: string | null;
  status: "pending" | "processing" | "done" | "failed";
  /** kind=print & status=done 일 때만 값 존재. true = 프린터 인쇄완료(0x40) 확인됨 */
  printed?: boolean | null;
  submitted_at: string;
  completed_at: string | null;
  error: string | null;
};

/** GET /api/v1/pf-printer/queue — 서버 FIFO 큐의 대기/처리/완료 작업 목록 (최대 100건) */
export async function pfPrinterQueue(): Promise<{ jobs: PfQueueJob[]; pendingCount: number; offline: boolean }> {
  try {
    const res = await pfFetch("/api/v1/pf-printer/queue", undefined, 8000);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || "upstream_status" in (j ?? {})) return { jobs: [], pendingCount: 0, offline: true };
    const jobs: PfQueueJob[] = Array.isArray(j?.jobs) ? j.jobs : [];
    return {
      jobs,
      pendingCount: typeof j?.pending_count === "number" ? j.pending_count : jobs.filter((x) => x.status === "pending" || x.status === "processing").length,
      offline: false,
    };
  } catch {
    return { jobs: [], pendingCount: 0, offline: true };
  }
}

/**
 * POST /api/v1/pf-printer/queue/clear — 아직 처리 시작 전(pending)인 요청을 모두 취소한다.
 * 지금 시리얼 통신 중인 1건은 끝까지 진행된다. 취소된 요청의 원 호출은 409를 받는다.
 */
export async function pfPrinterQueueClear(): Promise<{ ok: boolean; cleared: number; error?: string }> {
  try {
    const res = await pfFetch("/api/v1/pf-printer/queue/clear", { method: "POST", body: "{}" }, 15000);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || "upstream_status" in (j ?? {})) return { ok: false, cleared: 0, error: pfErrorText(j, res.status) };
    return { ok: true, cleared: typeof j?.cleared === "number" ? j.cleared : 0 };
  } catch (e) {
    return { ok: false, cleared: 0, error: String(e) };
  }
}

/**
 * 바코드/QR 값 인쇄. 응답이 오면 인쇄 트리거까지 완료된 상태다.
 * `printed`는 프린터의 인쇄완료(0x40) 응답까지 확인됐는지 여부(미확인이어도 에러는 아님).
 * @param padToLength 프린터 QR 객체의 "var length" (미지정 시 서버 기본값 사용)
 */
export async function pfPrint(
  text: string,
  padToLength?: number,
): Promise<{ ok: boolean; printed?: boolean; error?: string; payload: string }> {
  const payload = String(text ?? "").slice(0, 200);
  const body = JSON.stringify(padToLength ? { text: payload, pad_to_length: padToLength } : { text: payload });

  const attempt = async () => {
    const res = await pfFetch("/api/v1/pf-printer/test", { method: "POST", body });
    const j: any = await res.json().catch(() => ({}));
    return { res, j };
  };

  try {
    let { res, j } = await attempt();
    // 409 = NAK. 대개 Run 모드가 풀린 상태 → Run 전환 후 1회 재시도.
    if (res.status === 409 || (j as any)?.upstream_status === 409) {
      const run = await pfPrinterRun();
      if (run.ok) ({ res, j } = await attempt());
    }
    if (res.ok && j?.accepted) return { ok: true, printed: j?.printed === true, payload };
    return { ok: false, error: pfErrorText(j, res.status), payload };
  } catch (e) {
    return { ok: false, error: String(e), payload };
  }
}

