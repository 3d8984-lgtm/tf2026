DROP POLICY IF EXISTS "Authenticated users can view inspection ROI settings" ON public.inspection_roi_settings;
DROP POLICY IF EXISTS "Authenticated users can insert inspection ROI settings" ON public.inspection_roi_settings;
DROP POLICY IF EXISTS "Authenticated users can update inspection ROI settings" ON public.inspection_roi_settings;
DROP POLICY IF EXISTS "Authenticated users can delete inspection ROI settings" ON public.inspection_roi_settings;

CREATE POLICY "Approved users can view inspection ROI settings"
  ON public.inspection_roi_settings FOR SELECT TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "Approved users can insert inspection ROI settings"
  ON public.inspection_roi_settings FOR INSERT TO authenticated
  WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "Approved users can update inspection ROI settings"
  ON public.inspection_roi_settings FOR UPDATE TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()))
  WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "Approved users can delete inspection ROI settings"
  ON public.inspection_roi_settings FOR DELETE TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Anyone can view order logos" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can read order logos" ON storage.objects;
CREATE POLICY "Approved users can read order logos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'order-logos' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));