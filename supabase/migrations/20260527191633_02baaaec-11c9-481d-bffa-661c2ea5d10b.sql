DROP POLICY IF EXISTS "Authenticated read design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated manage design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Admins insert design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Admins update design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete design-formats" ON storage.objects;

CREATE POLICY "Authenticated read design-formats"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'design-formats');

CREATE POLICY "Authenticated manage design-formats"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'design-formats')
WITH CHECK (bucket_id = 'design-formats');