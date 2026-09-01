/**
 * 바코드 인쇄 작업의 순수 로직 (UI 무관 · 단위 테스트 대상)
 * - 스캔 검증 (순서/중복/불일치 → 중단)
 * - 인쇄 대기열 / 인쇄 완료 판정
 */

export const norm = (v: string) => (v || "").trim().toUpperCase();

export const ts = (v?: string | null) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

export type Verdict = "ok" | "order" | "mismatch" | "duplicate";

export type VerifyExpected = { position: number; no: string; keys: string[] };
export type VerifyEvent = { barcode: string; scanned_at: string };

export type VerifyRow = {
  at: string;
  barcode: string;
  verdict: Verdict;
  expected: string | null;
  position: number | null;
  /** 이 건을 인쇄 대기열에 적재해도 되는지 (중단 이전의 통과 건만 true) */
  enqueue: boolean;
};

export type VerifyResult = {
  rows: VerifyRow[];
  cursor: number;
  halted: boolean;
  lastVerdict: Verdict | null;
  lastCode: string;
  seen: Set<string>;
};

/**
 * 스캔 이벤트 배치를 순서대로 검증한다.
 * 불일치(순서/중복/미등록)가 1건이라도 나오면 그 시점부터 halted=true 가 되어
 * 이후 통과 건도 프린터로 전송하지 않는다(enqueue=false).
 */
export function verifyScanBatch(params: {
  events: VerifyEvent[];
  expected: VerifyExpected[];
  cursor: number;
  seen: Set<string>;
  halted: boolean;
  lastCode?: string;
}): VerifyResult {
  const { events, expected } = params;
  const seen = new Set(params.seen);
  let cursor = params.cursor;
  let blocked = params.halted;
  let halted = params.halted;
  let lastCode = params.lastCode ?? "";
  let lastVerdict: Verdict | null = null;
  const rows: VerifyRow[] = [];

  for (const ev of events) {
    const code = norm(ev.barcode);
    if (!code) continue;
    // 같은 값의 연속 이중 스캔은 1건으로만 반영
    if (code === lastCode) continue;
    lastCode = code;

    let verdict: Verdict = "mismatch";
    let position: number | null = null;
    let enqueue = false;
    const target = expected[cursor];

    if (seen.has(code)) {
      verdict = "duplicate";
      position = expected.findIndex((e) => e.keys.includes(code)) + 1 || null;
    } else if (target && target.keys.includes(code)) {
      verdict = "ok";
      position = target.position;
      seen.add(code);
      cursor += 1;
      enqueue = !blocked;
    } else {
      const found = expected.findIndex((e) => e.keys.includes(code));
      if (found >= 0) { verdict = "order"; position = found + 1; }
    }

    if (verdict !== "ok") { blocked = true; halted = true; }
    lastVerdict = verdict;
    rows.push({ at: ev.scanned_at, barcode: ev.barcode, verdict, expected: target?.no ?? null, position, enqueue });
  }

  return { rows, cursor, halted, lastVerdict, lastCode, seen };
}

export type QueueJob = {
  id: string;
  barcode: string;
  status: "pending" | "printing" | "done" | "failed";
  enqueued_at: string;
  printed_at: string | null;
  printed: boolean | null;
  error: string | null;
};

/** 패널2(인쇄 대기열) = 프린터 대기/인쇄 중 + 완료 응답이지만 물리 인쇄 미확인 */
export function selectWaitingJobs<T extends QueueJob>(jobs: T[]): T[] {
  return jobs.filter(
    (j) => j.status === "pending" || j.status === "printing" || (j.status === "done" && j.printed === false),
  );
}

/** printed=true 확인 건을 누적 맵에 병합 (프린터 서버 큐는 최근 100건만 유지) */
export function mergePrintedAcc(
  prev: Record<string, string>,
  jobs: QueueJob[],
): Record<string, string> {
  const next = { ...prev };
  let changed = false;
  for (const j of jobs) {
    // done 이면 완료로 본다 (printed 가 null 로 내려오는 게이트웨이 대응)
    if (j.status !== "done" || j.printed === false) continue;

    const k = norm(j.barcode);
    const at = j.printed_at ?? j.enqueued_at;
    if (!at) continue;
    if (!next[k] || ts(at) > ts(next[k])) { next[k] = at; changed = true; }
  }
  return changed ? next : prev;
}

/**
 * 패널3(인쇄 완료) 판정 — 프린터 완료 이벤트(0x40) 또는 printed=true 확인 건만.
 * 큐에서 밀려난 건은 누적 맵(printedAcc)으로 유지한다.
 */
export function resolvePrintedAt(params: {
  codes: string[];
  completeEvents: Record<string, string>;
  printedAcc: Record<string, string>;
  job?: QueueJob | null;
}): string | null {
  const { codes, completeEvents, printedAcc, job } = params;
  for (const c of codes) {
    const k = norm(c);
    if (completeEvents[k]) return completeEvents[k];
  }
  for (const c of codes) {
    const k = norm(c);
    if (printedAcc[k]) return printedAcc[k];
  }
  if (job && job.status === "done" && job.printed !== false) return job.printed_at ?? job.enqueued_at;
  return null;
}
