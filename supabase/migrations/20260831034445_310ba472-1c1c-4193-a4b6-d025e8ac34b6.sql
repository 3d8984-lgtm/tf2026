ALTER TABLE public.barcode_print_items
  ADD COLUMN IF NOT EXISTS print_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS printer_job_id text;

CREATE TABLE IF NOT EXISTS public.print_complete_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  job_id text,
  device text,
  printed boolean NOT NULL DEFAULT true,
  error text,
  raw jsonb,
  matched_item_id uuid REFERENCES public.barcode_print_items(id) ON DELETE SET NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_complete_events_code_idx ON public.print_complete_events (code);
CREATE INDEX IF NOT EXISTS print_complete_events_event_at_idx ON public.print_complete_events (event_at DESC);

GRANT SELECT ON public.print_complete_events TO authenticated;
GRANT ALL ON public.print_complete_events TO service_role;

ALTER TABLE public.print_complete_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view print complete events" ON public.print_complete_events;
CREATE POLICY "Authenticated can view print complete events"
ON public.print_complete_events FOR SELECT TO authenticated USING (true);