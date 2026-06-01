CREATE TYPE public.outsource_job_status AS ENUM ('pending','uploading','finalizing','done','failed');

CREATE TABLE public.outsource_order_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory text NOT NULL,
  order_no text NOT NULL,
  total_pngs integer NOT NULL DEFAULT 0,
  uploaded_pngs integer NOT NULL DEFAULT 0,
  status public.outsource_job_status NOT NULL DEFAULT 'pending',
  stage text NOT NULL DEFAULT '',
  zip_url text,
  error_message text,
  webhook_url text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outsource_order_jobs_order_no ON public.outsource_order_jobs (factory, order_no, created_at DESC);
CREATE INDEX idx_outsource_order_jobs_status ON public.outsource_order_jobs (status);

GRANT SELECT, INSERT, UPDATE ON public.outsource_order_jobs TO authenticated;
GRANT ALL ON public.outsource_order_jobs TO service_role;

ALTER TABLE public.outsource_order_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved view jobs"
ON public.outsource_order_jobs
FOR SELECT
TO authenticated
USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Admins insert jobs"
ON public.outsource_order_jobs
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins update jobs"
ON public.outsource_order_jobs
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins delete jobs"
ON public.outsource_order_jobs
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_outsource_order_jobs_updated_at
BEFORE UPDATE ON public.outsource_order_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();