DROP POLICY IF EXISTS "Approved users can view shipping groups" ON public.shipping_groups;
DROP POLICY IF EXISTS "Approved users can update shipping groups" ON public.shipping_groups;
DROP POLICY IF EXISTS "Approved users can create shipping groups" ON public.shipping_groups;
DROP POLICY IF EXISTS "Admins can delete shipping groups" ON public.shipping_groups;

CREATE POLICY "Approved read shipping_groups" ON public.shipping_groups
  FOR SELECT TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "Approved insert shipping_groups" ON public.shipping_groups
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "Approved update shipping_groups" ON public.shipping_groups
  FOR UPDATE TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()))
  WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "Admins delete shipping_groups" ON public.shipping_groups
  FOR DELETE TO authenticated
  USING (app_private.is_admin(auth.uid()));