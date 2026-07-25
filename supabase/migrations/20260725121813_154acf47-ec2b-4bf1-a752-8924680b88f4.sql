DROP POLICY IF EXISTS "auth insert plc_active_orders" ON public.plc_active_orders;
DROP POLICY IF EXISTS "auth update plc_active_orders" ON public.plc_active_orders;
DROP POLICY IF EXISTS "auth delete plc_active_orders" ON public.plc_active_orders;

CREATE POLICY "approved insert plc_active_orders" ON public.plc_active_orders
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved update plc_active_orders" ON public.plc_active_orders
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved delete plc_active_orders" ON public.plc_active_orders
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));