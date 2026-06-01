// Module-level upload coordinator for heat-transfer order finalization.
// Survives React Strict Mode double-effects and component remounts.
// Acts purely as an idempotency guard — the actual work runs inside the
// caller-supplied async runner so we don't duplicate business logic here.

type Runner = () => Promise<void>;

interface State {
  jobId: string | null;
  running: Promise<void> | null;
  startedAt: number;
}

const state: State = { jobId: null, running: null, startedAt: 0 };

export const uploadManager = {
  /** Returns current in-flight jobId, if any. */
  current(): string | null {
    return state.jobId;
  },
  isRunning(jobId?: string): boolean {
    if (!state.running) return false;
    return jobId ? state.jobId === jobId : true;
  },
  /**
   * Start (or join) a run for `jobId`. If a run for the same jobId is already
   * in flight, the returned promise resolves when that run finishes. If a
   * different jobId is currently running, throws — the caller should wait or
   * cancel before starting a new one.
   */
  async start(jobId: string, runner: Runner): Promise<void> {
    if (state.running) {
      if (state.jobId === jobId) {
        console.log("[Upload] join existing run", jobId);
        return state.running;
      }
      throw new Error(`다른 발주 작업이 진행 중입니다 (jobId=${state.jobId})`);
    }
    state.jobId = jobId;
    state.startedAt = Date.now();
    console.log("[Upload] start", jobId);
    state.running = (async () => {
      try {
        await runner();
        console.log("[Upload] done", jobId, `${Date.now() - state.startedAt}ms`);
      } catch (e) {
        console.error("[Upload] failed", jobId, e);
        throw e;
      } finally {
        state.running = null;
        state.jobId = null;
      }
    })();
    return state.running;
  },
};

export function logMemory(tag: string) {
  // performance.memory is Chromium-only; ignore elsewhere
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (mem) {
    console.log("[Memory]", tag, `${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)} MB`);
  }
}
