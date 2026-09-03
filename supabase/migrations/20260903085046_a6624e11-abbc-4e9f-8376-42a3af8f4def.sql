CREATE TABLE public.qr_label_print_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind text NOT NULL DEFAULT 'tshirt',
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  printer_name text,
  computer_id text,
  template jsonb NOT NULL DEFAULT '{}'::jsonb,
  total integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.qr_label_print_records (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid REFERENCES public.qr_label_print_jobs(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'tshirt',
  position integer NOT NULL,
  sticker_unique_id text NOT NULL,
  edition_number text,
  status text NOT NULL DEFAULT 'pending',
  queued_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  error_message text,
  printed_by uuid,
  printer_name text,
  computer_id text,
  bridge_job_id text,
  reprint_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX qr_label_print_records_order_idx ON public.qr_label_print_records(order_id, kind, position);
CREATE INDEX qr_label_print_jobs_order_idx ON public.qr_label_print_jobs(order_id, kind, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_label_print_jobs TO authenticated;
GRANT ALL ON public.qr_label_print_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_label_print_records TO authenticated;
GRANT ALL ON public.qr_label_print_records TO service_role;

ALTER TABLE public.qr_label_print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_label_print_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approved read jobs" ON public.qr_label_print_jobs FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "approved insert jobs" ON public.qr_label_print_jobs FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved update jobs" ON public.qr_label_print_jobs FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "admin delete jobs" ON public.qr_label_print_jobs FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "approved read records" ON public.qr_label_print_records FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "approved insert records" ON public.qr_label_print_records FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved update records" ON public.qr_label_print_records FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "admin delete records" ON public.qr_label_print_records FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TRIGGER qr_label_print_jobs_updated_at BEFORE UPDATE ON public.qr_label_print_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER qr_label_print_records_updated_at BEFORE UPDATE ON public.qr_label_print_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();