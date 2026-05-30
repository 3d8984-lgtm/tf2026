GRANT INSERT ON public.webhook_logs TO authenticated;

CREATE POLICY "Admins insert webhook_logs"
ON public.webhook_logs
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));