DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'png_job_status') THEN
    CREATE TYPE public.png_job_status AS ENUM ('pending','processing','completed','failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.png_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.outsource_order_jobs(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  status public.png_job_status NOT NULL DEFAULT 'pending',
  file_url text,
  error_message text,
  last_heartbeat timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, item_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.png_jobs TO authenticated;
GRANT ALL ON public.png_jobs TO service_role;

ALTER TABLE public.png_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved view png jobs" ON public.png_jobs;
CREATE POLICY "Approved view png jobs"
ON public.png_jobs
FOR SELECT
TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins insert png jobs" ON public.png_jobs;
CREATE POLICY "Admins insert png jobs"
ON public.png_jobs
FOR INSERT
TO authenticated
WITH CHECK (app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins update png jobs" ON public.png_jobs;
CREATE POLICY "Admins update png jobs"
ON public.png_jobs
FOR UPDATE
TO authenticated
USING (app_private.is_admin(auth.uid()))
WITH CHECK (app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins delete png jobs" ON public.png_jobs;
CREATE POLICY "Admins delete png jobs"
ON public.png_jobs
FOR DELETE
TO authenticated
USING (app_private.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_png_jobs_job_status ON public.png_jobs (job_id, status);
CREATE INDEX IF NOT EXISTS idx_png_jobs_stale_processing ON public.png_jobs (status, last_heartbeat) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_png_jobs_item ON public.png_jobs (job_id, item_id);

DROP TRIGGER IF EXISTS trg_png_jobs_updated_at ON public.png_jobs;
CREATE TRIGGER trg_png_jobs_updated_at
BEFORE UPDATE ON public.png_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.outsource_order_jobs
  ADD COLUMN IF NOT EXISTS zip_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zip_path text;

CREATE OR REPLACE FUNCTION public.requeue_stale_png_jobs(_older_than interval DEFAULT interval '30 seconds')
RETURNS TABLE(job_id uuid, requeued_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT p.job_id, p.id
    FROM public.png_jobs p
    JOIN public.outsource_order_jobs j ON j.id = p.job_id
    WHERE p.status = 'processing'
      AND COALESCE(p.last_heartbeat, p.updated_at, p.created_at) < now() - _older_than
      AND j.status IN ('uploading','finalizing','failed')
  ), upd AS (
    UPDATE public.png_jobs p
    SET status = 'pending',
        error_message = COALESCE(p.error_message, 'stale heartbeat - auto requeued'),
        last_heartbeat = now()
    FROM stale s
    WHERE p.id = s.id
    RETURNING p.job_id
  ), job_upd AS (
    UPDATE public.outsource_order_jobs j
    SET status = 'uploading',
        stage = '멈춘 PNG 작업 자동 재개 대기',
        error_message = NULL
    WHERE j.id IN (SELECT DISTINCT upd.job_id FROM upd)
    RETURNING j.id
  )
  SELECT upd.job_id, count(*)::integer
  FROM upd
  GROUP BY upd.job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.requeue_stale_png_jobs(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_png_jobs(interval) TO authenticated;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.png_jobs;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;