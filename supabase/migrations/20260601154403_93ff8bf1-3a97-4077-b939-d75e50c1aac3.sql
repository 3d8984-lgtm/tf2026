REVOKE ALL ON FUNCTION public.requeue_stale_png_jobs(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.requeue_stale_png_jobs(interval) FROM anon;
REVOKE ALL ON FUNCTION public.requeue_stale_png_jobs(interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_stale_png_jobs(interval) TO service_role;