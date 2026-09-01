ALTER TABLE public.barcode_print_items
  ADD COLUMN IF NOT EXISTS scan_sequence bigint,
  ADD COLUMN IF NOT EXISTS dispatch_status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS gateway_job_id text,
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS gateway_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS printer_run_state text,
  ADD COLUMN IF NOT EXISTS printer_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS serial_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS serial_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_code integer,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_detail text;

ALTER TABLE public.barcode_print_items
  DROP CONSTRAINT IF EXISTS barcode_print_items_dispatch_status_check;
ALTER TABLE public.barcode_print_items
  ADD CONSTRAINT barcode_print_items_dispatch_status_check
  CHECK (dispatch_status IN ('queued','dispatching','accepted','printing','printed','error'));

UPDATE public.barcode_print_items
SET dispatch_status = CASE
  WHEN status = 'done' THEN 'printed'
  WHEN status = 'error' THEN 'error'
  ELSE 'queued'
END
WHERE dispatch_status = 'queued';

CREATE INDEX IF NOT EXISTS barcode_print_items_dispatch_order_idx
ON public.barcode_print_items (kind, order_id, dispatch_status, position);