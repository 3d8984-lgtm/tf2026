DROP POLICY IF EXISTS "Admins insert webhook_logs" ON public.webhook_logs;

CREATE POLICY "Admins insert webhook_logs"
ON public.webhook_logs
FOR INSERT
TO authenticated
WITH CHECK (app_private.is_admin(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;