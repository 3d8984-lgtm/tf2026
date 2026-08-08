ALTER TABLE public.tshirt_work_items
  ADD COLUMN IF NOT EXISTS rework_reason text,
  ADD COLUMN IF NOT EXISTS reworked_at timestamptz,
  ADD COLUMN IF NOT EXISTS rework_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.defect_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'tshirt_work',
  order_id uuid,
  external_order_id text,
  item_no text,
  seq integer,
  defect_type text NOT NULL DEFAULT 'attach_fail',
  severity text NOT NULL DEFAULT 'medium',
  occurred_process text,
  detail text,
  status text NOT NULL DEFAULT 'unprocessed',
  restart_stage text,
  assignee text,
  resolved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_logs TO authenticated;
GRANT ALL ON public.defect_logs TO service_role;

ALTER TABLE public.defect_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can view defect logs" ON public.defect_logs
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "Approved users can insert defect logs" ON public.defect_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "Approved users can update defect logs" ON public.defect_logs
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "Admins can delete defect logs" ON public.defect_logs
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_defect_logs_updated_at BEFORE UPDATE ON public.defect_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_defect_logs_created_at ON public.defect_logs (created_at DESC);