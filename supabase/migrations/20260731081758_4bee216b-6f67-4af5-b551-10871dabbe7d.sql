DROP POLICY IF EXISTS "auth read plc_active_orders" ON public.plc_active_orders;
CREATE POLICY "approved read plc_active_orders" ON public.plc_active_orders
FOR SELECT TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "approved insert plc_active_orders" ON public.plc_active_orders;
CREATE POLICY "approved insert plc_active_orders" ON public.plc_active_orders
FOR INSERT TO authenticated
WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "approved update plc_active_orders" ON public.plc_active_orders;
CREATE POLICY "approved update plc_active_orders" ON public.plc_active_orders
FOR UPDATE TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()))
WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "approved delete plc_active_orders" ON public.plc_active_orders;
CREATE POLICY "approved delete plc_active_orders" ON public.plc_active_orders
FOR DELETE TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM authenticated, anon, PUBLIC;