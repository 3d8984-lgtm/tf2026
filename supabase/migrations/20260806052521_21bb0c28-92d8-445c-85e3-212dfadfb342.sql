DROP POLICY IF EXISTS "Approved users read own files in upload-files" ON storage.objects;
CREATE POLICY "Approved users read own files in upload-files" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'upload-files' AND (storage.foldername(name))[1] = (auth.uid())::text AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

DROP POLICY IF EXISTS "approved users can view couriers" ON public.courier_configs;
CREATE POLICY "approved users can view couriers" ON public.courier_configs FOR SELECT TO authenticated
USING (app_private.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can view cctv settings" ON public.cctv_camera_settings;
CREATE POLICY "Approved users can view cctv settings" ON public.cctv_camera_settings FOR SELECT TO authenticated
USING (app_private.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can upsert cctv settings" ON public.cctv_camera_settings;
CREATE POLICY "Approved users can upsert cctv settings" ON public.cctv_camera_settings FOR INSERT TO authenticated
WITH CHECK (app_private.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can update cctv settings" ON public.cctv_camera_settings;
CREATE POLICY "Approved users can update cctv settings" ON public.cctv_camera_settings FOR UPDATE TO authenticated
USING (app_private.is_approved(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()));