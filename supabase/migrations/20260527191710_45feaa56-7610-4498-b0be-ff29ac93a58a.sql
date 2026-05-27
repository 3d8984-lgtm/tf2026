DROP POLICY IF EXISTS "Authenticated read design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated manage design-formats" ON storage.objects;

CREATE POLICY "Authenticated insert design-formats"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'design-formats');

CREATE POLICY "Authenticated update design-formats"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'design-formats')
WITH CHECK (bucket_id = 'design-formats');

CREATE POLICY "Authenticated delete design-formats"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'design-formats');