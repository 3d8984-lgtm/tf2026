import { describe, it, expect } from "vitest";
import {
  verifyScanBatch,
  selectWaitingJobs,
  mergePrintedAcc,
  resolvePrintedAt,
  type QueueJob,
} from "./barcode-print-logic";

const exp = (nos: string[]) =>
  nos.map((no, i) => ({ position: i + 1, no, keys: [no.toUpperCase()] }));

const ev = (barcode: string, at = "2026-08-31T00:00:00Z") => ({ barcode, scanned_at: at });

describe("verifyScanBatch", () => {
  const expected = exp(["A-4", "B-4", "C-4"]);

  it("순서대로 스캔하면 모두 통과하고 커서가 전진한다", () => {
    const r = verifyScanBatch({
      events: [ev("A-4"), ev("B-4")],
      expected, cursor: 0, seen: new Set(), halted: false,
    });
    expect(r.rows.map((x) => x.verdict)).toEqual(["ok", "ok"]);
    expect(r.rows.every((x) => x.enqueue)).toBe(true);
    expect(r.cursor).toBe(2);
    expect(r.halted).toBe(false);
  });

  it("순서가 틀리면 order 판정 + 중단", () => {
    const r = verifyScanBatch({ events: [ev("C-4")], expected, cursor: 0, seen: new Set(), halted: false });
    expect(r.rows[0].verdict).toBe("order");
    expect(r.rows[0].position).toBe(3);
    expect(r.rows[0].enqueue).toBe(false);
    expect(r.halted).toBe(true);
    expect(r.cursor).toBe(0);
  });

  it("주문에 없는 코드는 mismatch + 중단", () => {
    const r = verifyScanBatch({ events: [ev("ZZ-4")], expected, cursor: 0, seen: new Set(), halted: false });
    expect(r.rows[0].verdict).toBe("mismatch");
    expect(r.halted).toBe(true);
  });

  it("이미 처리한 코드는 duplicate + 중단", () => {
    const r = verifyScanBatch({
      events: [ev("A-4")], expected, cursor: 1, seen: new Set(["A-4"]), halted: false,
    });
    expect(r.rows[0].verdict).toBe("duplicate");
    expect(r.halted).toBe(true);
  });

  it("연속 이중 스캔은 1건으로만 반영된다", () => {
    const r = verifyScanBatch({
      events: [ev("A-4"), ev("A-4")], expected, cursor: 0, seen: new Set(), halted: false,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.cursor).toBe(1);
    expect(r.halted).toBe(false);
  });

  it("중단 이후의 통과 건은 검증만 되고 인쇄 전송되지 않는다", () => {
    const r = verifyScanBatch({
      events: [ev("A-4")], expected, cursor: 0, seen: new Set(), halted: true,
    });
    expect(r.rows[0].verdict).toBe("ok");
    expect(r.rows[0].enqueue).toBe(false);
  });

  it("배치 중간에 불일치가 나오면 뒤따르는 통과 건도 전송 차단", () => {
    const r = verifyScanBatch({
      events: [ev("A-4"), ev("ZZ"), ev("B-4")], expected, cursor: 0, seen: new Set(), halted: false,
    });
    expect(r.rows.map((x) => x.verdict)).toEqual(["ok", "mismatch", "ok"]);
    expect(r.rows.map((x) => x.enqueue)).toEqual([true, false, false]);
    expect(r.halted).toBe(true);
  });
});

const job = (p: Partial<QueueJob>): QueueJob => ({
  id: "1", barcode: "A-4", status: "done", enqueued_at: "2026-08-31T00:00:00Z",
  printed_at: "2026-08-31T00:00:05Z", printed: true, error: null, ...p,
});

describe("selectWaitingJobs", () => {
  it("대기/인쇄중/완료미확인만 대기열에 포함한다", () => {
    const jobs = [
      job({ id: "1", status: "pending", printed: null, printed_at: null }),
      job({ id: "2", status: "printing", printed: null, printed_at: null }),
      job({ id: "3", status: "done", printed: false }),
      job({ id: "4", status: "done", printed: true }),
      job({ id: "5", status: "failed", printed: null }),
    ];
    expect(selectWaitingJobs(jobs).map((j) => j.id)).toEqual(["1", "2", "3"]);
  });
});

describe("mergePrintedAcc", () => {
  it("printed=true 건만 누적하고 큐에서 사라져도 유지된다", () => {
    const acc1 = mergePrintedAcc({}, [job({ barcode: "a-4" }), job({ id: "2", barcode: "B-4", printed: false })]);
    expect(Object.keys(acc1)).toEqual(["A-4"]);
    const acc2 = mergePrintedAcc(acc1, []);
    expect(acc2).toBe(acc1);
    expect(acc2["A-4"]).toBe("2026-08-31T00:00:05Z");
  });

  it("더 최신 시각으로만 갱신한다", () => {
    const acc = mergePrintedAcc({ "A-4": "2026-08-31T00:00:09Z" }, [job({})]);
    expect(acc["A-4"]).toBe("2026-08-31T00:00:09Z");
  });
});

describe("resolvePrintedAt", () => {
  it("프린터 완료 이벤트를 최우선으로 사용한다", () => {
    const at = resolvePrintedAt({
      codes: ["A-4"], completeEvents: { "A-4": "2026-08-31T01:00:00Z" },
      printedAcc: { "A-4": "2026-08-31T00:00:05Z" }, job: job({}),
    });
    expect(at).toBe("2026-08-31T01:00:00Z");
  });

  it("이벤트가 없으면 누적 맵을 사용한다", () => {
    expect(resolvePrintedAt({ codes: ["a-4"], completeEvents: {}, printedAcc: { "A-4": "t" }, job: null })).toBe("t");
  });

  it("printed_at 이 비어도 printed=true 면 완료로 본다", () => {
    expect(resolvePrintedAt({
      codes: ["A-4"], completeEvents: {}, printedAcc: {}, job: job({ printed_at: null }),
    })).toBe("2026-08-31T00:00:00Z");
  });

  it("전송만 되고 인쇄 미확인이면 완료가 아니다", () => {
    expect(resolvePrintedAt({
      codes: ["A-4"], completeEvents: {}, printedAcc: {}, job: job({ printed: false }),
    })).toBeNull();
    expect(resolvePrintedAt({
      codes: ["A-4"], completeEvents: {}, printedAcc: {}, job: job({ status: "failed", printed: null }),
    })).toBeNull();
  });
});
