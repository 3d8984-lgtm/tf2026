
-- Drop legacy tables (browser PNG flow is being retired)
DROP TABLE IF EXISTS public.png_jobs CASCADE;
DROP TABLE IF EXISTS public.outsource_order_jobs CASCADE;
DROP TYPE IF EXISTS public.png_job_status CASCADE;
DROP TYPE IF EXISTS public.outsource_job_status CASCADE;

-- New enums
CREATE TYPE public.order_job_status AS ENUM (
  'queued', 'processing', 'uploading', 'wechat', 'done', 'failed'
);
CREATE TYPE public.order_item_status AS ENUM (
  'pending', 'processing', 'uploaded', 'failed', 'skipped'
);

-- order_jobs: one row per order
CREATE TABLE public.order_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL UNIQUE,
  factory text NOT NULL,
  status public.order_job_status NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT '',
  progress_current int NOT NULL DEFAULT 0,
  progress_total int NOT NULL DEFAULT 0,
  webhook_url text NOT NULL DEFAULT '',
  callback_url text,
  bundle_zip_path text,
  bundle_zip_url text,
  bundle_size bigint,
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_jobs TO authenticated;
GRANT ALL ON public.order_jobs TO service_role;

ALTER TABLE public.order_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved view order_jobs" ON public.order_jobs
  FOR SELECT TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "Admins insert order_jobs" ON public.order_jobs
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins update order_jobs" ON public.order_jobs
  FOR UPDATE TO authenticated
  USING (app_private.is_admin(auth.uid()))
  WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins delete order_jobs" ON public.order_jobs
  FOR DELETE TO authenticated
  USING (app_private.is_admin(auth.uid()));

CREATE TRIGGER trg_order_jobs_updated_at
  BEFORE UPDATE ON public.order_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_order_jobs_status ON public.order_jobs(status);
CREATE INDEX idx_order_jobs_created_at ON public.order_jobs(created_at DESC);

-- order_job_items: one row per design
CREATE TABLE public.order_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.order_jobs(id) ON DELETE CASCADE,
  idx int NOT NULL,
  source_url text NOT NULL,
  filename text NOT NULL DEFAULT '',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.order_item_status NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  error_message text,
  output_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_job_items TO authenticated;
GRANT ALL ON public.order_job_items TO service_role;

ALTER TABLE public.order_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved view order_job_items" ON public.order_job_items
  FOR SELECT TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "Admins insert order_job_items" ON public.order_job_items
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins update order_job_items" ON public.order_job_items
  FOR UPDATE TO authenticated
  USING (app_private.is_admin(auth.uid()))
  WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins delete order_job_items" ON public.order_job_items
  FOR DELETE TO authenticated
  USING (app_private.is_admin(auth.uid()));

CREATE TRIGGER trg_order_job_items_updated_at
  BEFORE UPDATE ON public.order_job_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_order_job_items_job_id ON public.order_job_items(job_id, idx);
CREATE INDEX idx_order_job_items_status ON public.order_job_items(job_id, status);

-- Drop legacy helper if it referenced png_jobs
DROP FUNCTION IF EXISTS public.requeue_stale_png_jobs(interval) CASCADE;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_job_items;
ALTER TABLE public.order_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.order_job_items REPLICA IDENTITY FULL;
