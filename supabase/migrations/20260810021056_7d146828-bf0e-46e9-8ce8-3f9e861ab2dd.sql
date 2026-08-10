-- 1) Standardize all policies on the hardened app_private helpers

-- defect_logs
DROP POLICY IF EXISTS "Approved users can view defect logs" ON public.defect_logs;
CREATE POLICY "Approved users can view defect logs" ON public.defect_logs FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved users can insert defect logs" ON public.defect_logs;
CREATE POLICY "Approved users can insert defect logs" ON public.defect_logs FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved users can update defect logs" ON public.defect_logs;
CREATE POLICY "Approved users can update defect logs" ON public.defect_logs FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Admins can delete defect logs" ON public.defect_logs;
CREATE POLICY "Admins can delete defect logs" ON public.defect_logs FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- courier_configs
DROP POLICY IF EXISTS "admins can insert couriers" ON public.courier_configs;
CREATE POLICY "admins can insert couriers" ON public.courier_configs FOR INSERT TO authenticated WITH CHECK (app_private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "admins can update couriers" ON public.courier_configs;
CREATE POLICY "admins can update couriers" ON public.courier_configs FOR UPDATE TO authenticated USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));
DROP POLICY IF EXISTS "admins can delete couriers" ON public.courier_configs;
CREATE POLICY "admins can delete couriers" ON public.courier_configs FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- tshirt_work_items
DROP POLICY IF EXISTS "Approved users can view tshirt work items" ON public.tshirt_work_items;
CREATE POLICY "Approved users can view tshirt work items" ON public.tshirt_work_items FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved users can insert tshirt work items" ON public.tshirt_work_items;
CREATE POLICY "Approved users can insert tshirt work items" ON public.tshirt_work_items FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Approved users can update tshirt work items" ON public.tshirt_work_items;
CREATE POLICY "Approved users can update tshirt work items" ON public.tshirt_work_items FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Admins can delete tshirt work items" ON public.tshirt_work_items;
CREATE POLICY "Admins can delete tshirt work items" ON public.tshirt_work_items FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- work_video_records
DROP POLICY IF EXISTS "wvr_select_approved" ON public.work_video_records;
CREATE POLICY "wvr_select_approved" ON public.work_video_records FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "wvr_insert_approved" ON public.work_video_records;
CREATE POLICY "wvr_insert_approved" ON public.work_video_records FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "wvr_update_approved" ON public.work_video_records;
CREATE POLICY "wvr_update_approved" ON public.work_video_records FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "wvr_delete_admin" ON public.work_video_records;
CREATE POLICY "wvr_delete_admin" ON public.work_video_records FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- work_video_settings
DROP POLICY IF EXISTS "wvs_select_approved" ON public.work_video_settings;
CREATE POLICY "wvs_select_approved" ON public.work_video_settings FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "wvs_admin_all" ON public.work_video_settings;
CREATE POLICY "wvs_admin_all" ON public.work_video_settings FOR ALL TO authenticated USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));

-- barcode_print_items
DROP POLICY IF EXISTS "approved users can read barcode print items" ON public.barcode_print_items;
CREATE POLICY "approved users can read barcode print items" ON public.barcode_print_items FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "approved users can insert barcode print items" ON public.barcode_print_items;
CREATE POLICY "approved users can insert barcode print items" ON public.barcode_print_items FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "approved users can update barcode print items" ON public.barcode_print_items;
CREATE POLICY "approved users can update barcode print items" ON public.barcode_print_items FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()));
DROP POLICY IF EXISTS "approved users can delete barcode print items" ON public.barcode_print_items;
CREATE POLICY "approved users can delete barcode print items" ON public.barcode_print_items FOR DELETE TO authenticated USING (app_private.is_approved(auth.uid()));

-- cctv_camera_settings
DROP POLICY IF EXISTS "Admins can delete cctv settings" ON public.cctv_camera_settings;
CREATE POLICY "Admins can delete cctv settings" ON public.cctv_camera_settings FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- 2) Lock down courier_credentials to service_role only
DROP POLICY IF EXISTS "service role only" ON public.courier_credentials;
CREATE POLICY "service role only" ON public.courier_credentials FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.courier_credentials FROM anon, authenticated;
GRANT ALL ON public.courier_credentials TO service_role;