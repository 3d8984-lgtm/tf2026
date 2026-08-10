DROP POLICY IF EXISTS "work_videos_select_approved" ON storage.objects;
DROP POLICY IF EXISTS "work_videos_insert_approved" ON storage.objects;
DROP POLICY IF EXISTS "work_videos_update_approved" ON storage.objects;
DROP POLICY IF EXISTS "work_videos_delete_admin" ON storage.objects;

CREATE POLICY "work_videos_select_approved" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'work-videos' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

CREATE POLICY "work_videos_insert_approved" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'work-videos' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

CREATE POLICY "work_videos_update_approved" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'work-videos' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())))
WITH CHECK (bucket_id = 'work-videos' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

CREATE POLICY "work_videos_delete_admin" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'work-videos' AND app_private.is_admin(auth.uid()));