// Worker-pool coordinator for heat-transfer PNG generation.
// Spawns N module workers; routes tasks; streams PNG Blob results.
import type { FooterCfg } from "./htPng.worker";

export interface PoolTask {
  idx: number;
  designUid: string;
  designSrc: string;
  maskKey: string;
  maskBlob: Blob;
  targetW: number;
  targetH: number;
  widthPt: number;
  dpi: number;
  transform: { offsetXPct: number; offsetYPct: number; scale: number };
  footer: FooterCfg;
  meta: { tshirtType?: string; tshirtColor?: string; tshirtSize?: string };
}

export interface PoolResult {
  idx: number;
  designUid: string;
  blob: Blob | null;
  reason?: string;
}

type WorkerDoneMsg = { type: "done"; idx: number; designUid: string; buffer: ArrayBuffer };
type WorkerErrorMsg = { type: "error"; message?: string };
type WorkerMsg = WorkerDoneMsg | WorkerErrorMsg;

type Pending = { task: PoolTask; resolve: (r: PoolResult) => void };

interface WorkerSlot {
  w: Worker;
  busy: boolean;
  current: Pending | null;
}

export class HtPngPool {
  private slots: WorkerSlot[] = [];
  private queue: Pending[] = [];

  constructor(size: number) {
    const n = Math.max(1, Math.min(8, size | 0));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./htPng.worker.ts", import.meta.url), { type: "module" });
      const slot: WorkerSlot = { w, busy: false, current: null };
      w.onmessage = (e: MessageEvent<WorkerMsg>) => this.onMessage(slot, e.data);
      w.onerror = (e) => this.onError(slot, e.message || "worker error");
      this.slots.push(slot);
    }
  }

  enqueue(task: PoolTask): Promise<PoolResult> {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve });
      this.pump();
    });
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.busy || this.queue.length === 0) continue;
      const next = this.queue.shift()!;
      slot.busy = true;
      slot.current = next;
      const { task } = next;
      slot.w.postMessage({ type: "build", ...task });
    }
  }

  private onMessage(slot: WorkerSlot, data: WorkerMsg) {
    const p = slot.current;
    if (!p) return;
    slot.current = null;
    slot.busy = false;
    if (data?.type === "done") {
      const blob = new Blob([data.buffer], { type: "image/png" });
      p.resolve({ idx: data.idx, designUid: data.designUid, blob });
    } else {
      p.resolve({
        idx: p.task.idx, designUid: p.task.designUid,
        blob: null, reason: data?.message || "worker 실패",
      });
    }
    this.pump();
  }

  private onError(slot: WorkerSlot, message: string) {
    const p = slot.current;
    slot.current = null;
    slot.busy = false;
    if (p) {
      p.resolve({
        idx: p.task.idx, designUid: p.task.designUid,
        blob: null, reason: message,
      });
    }
    this.pump();
  }

  dropMask(maskKey: string) {
    for (const s of this.slots) s.w.postMessage({ type: "drop-mask", maskKey });
  }

  terminate() {
    for (const s of this.slots) s.w.terminate();
    this.slots = [];
    this.queue = [];
  }
}
