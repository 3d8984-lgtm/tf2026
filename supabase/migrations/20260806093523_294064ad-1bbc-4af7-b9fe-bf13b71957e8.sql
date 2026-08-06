
-- design-images: explicit read for approved users
DROP POLICY IF EXISTS "Approved users can read design-images" ON storage.objects;
CREATE POLICY "Approved users can read design-images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'design-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

-- design-images: writes by approved users (matches file upload workflow)
DROP POLICY IF EXISTS "Admins upload design images" ON storage.objects;
DROP POLICY IF EXISTS "Admins update design images" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete design images" ON storage.objects;
CREATE POLICY "Approved users can upload design images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'design-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "Approved users can update design images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'design-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())))
WITH CHECK (bucket_id = 'design-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "Approved users can delete design images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'design-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

-- twincode-images: writes by approved users (matches file upload workflow)
DROP POLICY IF EXISTS "Admins upload twincode images" ON storage.objects;
DROP POLICY IF EXISTS "Admins update twincode images" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete twincode images" ON storage.objects;
CREATE POLICY "Approved users can upload twincode images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'twincode-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "Approved users can update twincode images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'twincode-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())))
WITH CHECK (bucket_id = 'twincode-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "Approved users can delete twincode images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'twincode-images' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
