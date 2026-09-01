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
export type PfErrorCode =
  | "PRINTER_NOT_READY"
  | "PRINTER_SERIAL_DISCONNECTED"
  | "PRINTER_NAK"
  | "PRINTER_RESPONSE_TIMEOUT"
  | "QUEUE_CANCELLED"
  | "GATEWAY_OFFLINE"
  | "INVALID_REQUEST"
  | "GATEWAY_ERROR";

export function pfErrorCode(j: any, status: number): PfErrorCode {
  if (typeof j?.error_code === "string" && j.error_code) return j.error_code as PfErrorCode;
  if (status === 422) return "INVALID_REQUEST";
  if (status === 503) return "PRINTER_SERIAL_DISCONNECTED";
  if (status === 504) return "PRINTER_RESPONSE_TIMEOUT";
  if (status === 409) return "PRINTER_NAK";
  return "GATEWAY_ERROR";
}

export function isPfPrintAccepted(resOk: boolean, body: any): body is { accepted: true; id: string } {
  return resOk === true && body?.accepted === true && typeof body?.id === "string" && body.id.length > 0 &&
    body?.offline !== true && !body?.error && !body?.error_code;
}

export function pfErrorText(j: any, status: number): string {
  const d = j?.detail;
  const base = typeof d === "string"
    ? d
    : Array.isArray(d) ? d.map((x: any) => x?.msg ?? String(x)).join(", ") : "";
  if (j?.error_code === "QUEUE_CANCELLED") return "대기열 초기화로 취소된 요청입니다";
  const hint =
    status === 409 ? "프린터 NAK (Run 모드 아님 / var length 불일치)"
    : status === 503 ? "프린터 시리얼 포트에 연결할 수 없음"
    : status === 502 ? "프린터 통신 오류"
    : status === 422 ? "값이 비었거나 200자를 초과함"
    : `HTTP ${status}`;
  return base || hint;
}

export type PfStatus = {
  ink_percent: number | null;
  buffer_count: number | null;
  offline: boolean;
  running: boolean | null;
  ready: boolean | null;
  runState: string | null;
  errorCode?: PfErrorCode;
  error?: string;
};

export async function pfPrinterStatus(): Promise<PfStatus> {
  try {
    const res = await pfFetch("/api/v1/pf-printer/status", undefined, 8000);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j?.offline === true || j?.error || j?.error_code) return {
      ink_percent: null, buffer_count: null, offline: true, running: null, ready: null, runState: null,
      errorCode: pfErrorCode(j, res.status), error: pfErrorText(j, res.status),
    };
    const state = typeof j?.run_state === "string" ? j.run_state : typeof j?.state === "string" ? j.state : null;
    const running = typeof j?.running === "boolean" ? j.running : state ? /run/i.test(state) : null;
    const ready = typeof j?.ready === "boolean" ? j.ready : state ? /ready/i.test(state) : null;
    return {
      ink_percent: typeof j?.ink_percent === "number" ? j.ink_percent : null,
      buffer_count: typeof j?.buffer_count === "number" ? j.buffer_count : null,
      offline: false,
      running,
      ready,
      runState: state ?? (ready ? "READY" : running ? "RUN" : null),
    };
  } catch (e) {
    return { ink_percent: null, buffer_count: null, offline: true, running: null, ready: null, runState: null, errorCode: "GATEWAY_OFFLINE", error: String(e) };
  }
}

async function pfMode(mode: "run" | "stop"): Promise<{ ok: boolean; errorCode?: PfErrorCode; error?: string; runState?: string | null }> {
  try {
    const res = await pfFetch(`/api/v1/pf-printer/${mode}`, { method: "POST", body: "{}" }, 20000);
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.accepted === true && !j?.error && !j?.error_code && !j?.offline) {
      return { ok: true, runState: typeof j?.running === "boolean" ? (j.running ? "RUN" : "STOP") : null };
    }
    return { ok: false, errorCode: pfErrorCode(j, res.status), error: pfErrorText(j, res.status) };
  } catch (e) {
    return { ok: false, errorCode: "GATEWAY_OFFLINE", error: String(e) };
  }
}

export const pfPrinterRun = () => pfMode("run");
export const pfPrinterStop = () => pfMode("stop");

export type PfReadyResult = {
  ok: boolean;
  readyAt?: string;
  runState?: string | null;
  errorCode?: PfErrorCode;
  error?: string;
};

/** RUN 요청 후 Gateway가 명시적으로 READY를 보고할 때까지 기다린다. */
export async function pfEnsureReady(maxWaitMs = 8000, pollMs = 400): Promise<PfReadyResult> {
  const run = await pfPrinterRun();
  if (!run.ok) return run;
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const status = await pfPrinterStatus();
    if (status.offline) return { ok: false, errorCode: status.errorCode ?? "GATEWAY_OFFLINE", error: status.error ?? "Gateway offline" };
    // New gateways expose ready/running explicitly. Older deployed gateways only
    // return ink/buffer from /status; there, an accepted RUN followed by a
    // successful serial status round-trip is the strongest READY proof.
    const explicitReady = status.ready === true && status.running !== false;
    const legacyReady = status.ready == null && status.running == null && run.runState === "RUN";
    if (explicitReady || legacyReady) {
      return { ok: true, readyAt: new Date().toISOString(), runState: status.runState ?? run.runState ?? "READY" };
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }
  return { ok: false, errorCode: "PRINTER_NOT_READY", error: "프린터가 제한 시간 안에 READY 상태가 되지 않았습니다", runState: "RUN/NOT_READY" };
}

export type PfQueueJob = {
  id: string;
  /** 2026-09 서버 개정 이후 큐에는 print job 만 나온다(run/stop/status 제외) */
  kind: "print";
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
    // 개정 서버는 print job 만 내려주지만, 구버전 응답과 섞여도 안전하도록 방어 필터링
    const jobs: PfQueueJob[] = (Array.isArray(j?.jobs) ? j.jobs : []).filter((x: any) => !x?.kind || x.kind === "print");
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
 * POST /api/v1/pf-printer/buffer/clear — queue/clear 보다 강력한 초기화.
 * pending 취소에 더해, 이미 프린터에 접수되어 물리 버퍼에 쌓여 있던(processing) 요청까지
 * CMD_CLEAR_BUFFER(0x13)로 전부 지운다. 그 요청들은 인쇄되지 않고 failed 로 갱신된다.
 * 주의: 이미 accepted 응답을 받은 /test 호출에는 실패가 통보되지 않으므로,
 * 이후 GET /queue 에서 status=failed 를 확인해야 한다.
 */
export async function pfPrinterBufferClear(): Promise<{ ok: boolean; cancelledPending: number; failedProcessing: number; error?: string }> {
  try {
    const res = await pfFetch("/api/v1/pf-printer/buffer/clear", { method: "POST", body: "{}" }, 20000);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || "upstream_status" in (j ?? {})) {
      return { ok: false, cancelledPending: 0, failedProcessing: 0, error: pfErrorText(j, res.status) };
    }
    return {
      ok: true,
      cancelledPending: typeof j?.cancelled_pending === "number" ? j.cancelled_pending : 0,
      failedProcessing: typeof j?.failed_processing === "number" ? j.failed_processing : 0,
    };
  } catch (e) {
    return { ok: false, cancelledPending: 0, failedProcessing: 0, error: String(e) };
  }
}

/**
 * 바코드/QR 값 인쇄. 응답이 오면 프린터 버퍼에 접수까지 완료된 상태다(물리 인쇄 완료 아님).
 * `printed`=true 는 응답 시점에 이미 물리 인쇄완료(0x40)까지 확인된 경우(프린터 idle 시).
 * null/false 면 `id`로 GET /queue 를 폴링해 status="done" && printed=true 를 확인한다.
 * @param padToLength 프린터 QR 객체의 "var length" (미지정 시 서버 기본값 사용, 현장 기본 38)
 */
export type PfPrintResult = {
  ok: boolean;
  printed?: boolean;
  id?: string;
  error?: string;
  errorCode?: PfErrorCode;
  retryable?: boolean;
  responseCode?: number;
  retryCount: number;
  serialSendAt?: string;
  serialResponseAt?: string;
  payload: string;
  /** 구간별 소요 시간 진단 (프론트 시작 → 프록시 수신 → 게이트웨이/시리얼 → 프론트 수신) */
  timing?: {
    requestStartedAt: string;
    proxyReceivedAt?: string;
    proxyUpstreamMs?: number;
    frontendTotalMs: number;
  };
};

export async function pfPrint(
  text: string,
  padToLength?: number,
): Promise<PfPrintResult> {
  const payload = String(text ?? "").slice(0, 200);
  const body = JSON.stringify(padToLength ? { text: payload, pad_to_length: padToLength } : { text: payload });

  const requestStartedAt = new Date().toISOString();
  const t0 = Date.now();
  const readTiming = (res: Response, j: any) => ({
    requestStartedAt,
    proxyReceivedAt: res.headers.get("x-proxy-received-at") ?? (typeof j?.proxy_received_at === "string" ? j.proxy_received_at : undefined),
    proxyUpstreamMs: Number(res.headers.get("x-proxy-upstream-ms") ?? j?.proxy_upstream_ms ?? NaN) || undefined,
    frontendTotalMs: Date.now() - t0,
  });

  const attempt = async () => {
    // 개정 서버는 접수 즉시 응답하므로 긴 대기가 필요 없다(네트워크/직렬화 여유만 둠)
    const res = await pfFetch("/api/v1/pf-printer/test", { method: "POST", body }, 15000);
    const j: any = await res.json().catch(() => ({}));
    return { res, j };
  };

  try {
    let { res, j } = await attempt();
    let retryCount = 0;
    let code = pfErrorCode(j, res.status);
    // Only NAK/not-ready is safe for one frontend retry, and only after an
    // explicit READY confirmation. Response timeout is never re-POSTed here.
    if (!isPfPrintAccepted(res.ok, j) &&
        (code === "PRINTER_NAK" || code === "PRINTER_NOT_READY")) {
      const ready = await pfEnsureReady();
      if (ready.ok) {
        retryCount = 1;
        ({ res, j } = await attempt());
        code = pfErrorCode(j, res.status);
      } else {
        return { ok: false, errorCode: ready.errorCode, error: ready.error, retryable: false, responseCode: res.status, retryCount, payload };
      }
    }
    const validSuccess = isPfPrintAccepted(res.ok, j);
    if (validSuccess) return {
      ok: true, printed: j?.printed === true, id: j.id, responseCode: res.status, retryCount,
      serialSendAt: typeof j?.serial_send_at === "string" ? j.serial_send_at : undefined,
      serialResponseAt: typeof j?.serial_response_at === "string" ? j.serial_response_at : undefined,
      payload,
    };
    return {
      ok: false, errorCode: code, error: pfErrorText(j, res.status), retryable: j?.retryable === true,
      id: typeof j?.gateway_job_id === "string" ? j.gateway_job_id : typeof j?.id === "string" ? j.id : undefined,
      responseCode: res.status, retryCount, payload,
    };
  } catch (e) {
    return { ok: false, errorCode: "GATEWAY_OFFLINE", error: String(e), retryable: false, retryCount: 0, payload };
  }
}

