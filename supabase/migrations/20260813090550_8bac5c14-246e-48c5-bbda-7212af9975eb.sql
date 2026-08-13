DROP POLICY IF EXISTS "approved users can read barcode print resets" ON public.barcode_print_resets;
DROP POLICY IF EXISTS "approved users can insert barcode print resets" ON public.barcode_print_resets;
DROP POLICY IF EXISTS "approved users can update barcode print resets" ON public.barcode_print_resets;
DROP POLICY IF EXISTS "approved users can delete barcode print resets" ON public.barcode_print_resets;

CREATE POLICY "approved users can read barcode print resets"
ON public.barcode_print_resets FOR SELECT TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "approved users can insert barcode print resets"
ON public.barcode_print_resets FOR INSERT TO authenticated
WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "approved users can update barcode print resets"
ON public.barcode_print_resets FOR UPDATE TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()))
WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "approved users can delete barcode print resets"
ON public.barcode_print_resets FOR DELETE TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));