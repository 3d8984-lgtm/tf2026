// Legacy compatibility shim. The browser-side ZIP/PNG flow has been replaced by
// the Railway worker + /v1/orders Edge Function. This module remains only so the
// existing HeatTransferFactory page keeps compiling while the migration finishes.
// New code should call `supabase.functions.invoke('orders-create', ...)` and
// observe progress through the `order_jobs` / `order_job_items` tables instead.

type Runner = () => Promise<void>;

export const uploadManager = {
  current(): string | null { return null; },
  isRunning(_jobId?: string): boolean { return false; },
  async start(_jobId: string, runner: Runner): Promise<void> { await runner(); },
};

export function logMemory(_tag: string) {}
