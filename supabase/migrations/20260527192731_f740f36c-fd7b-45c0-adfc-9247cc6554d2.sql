DROP POLICY IF EXISTS "Authenticated insert design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete design-formats" ON storage.objects;

CREATE POLICY "Authenticated users can upload design-formats"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'design-formats'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Authenticated users can update design-formats"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'design-formats'
  AND auth.role() = 'authenticated'
)
WITH CHECK (
  bucket_id = 'design-formats'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Authenticated users can delete design-formats"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'design-formats'
  AND auth.role() = 'authenticated'
);