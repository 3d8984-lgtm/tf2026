DROP POLICY IF EXISTS "Approved users can read card-frames" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can read twincode-images" ON storage.objects;
CREATE POLICY "Approved users can read card-frames" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'card-frames' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "Approved users can read twincode-images" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'twincode-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));