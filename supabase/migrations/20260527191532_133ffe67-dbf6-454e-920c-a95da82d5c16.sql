ALTER POLICY "Admins insert design-formats"
ON storage.objects
WITH CHECK (
  bucket_id = 'design-formats'
  AND auth.role() = 'authenticated'
);

ALTER POLICY "Admins update design-formats"
ON storage.objects
USING (
  bucket_id = 'design-formats'
  AND auth.role() = 'authenticated'
)
WITH CHECK (
  bucket_id = 'design-formats'
  AND auth.role() = 'authenticated'
);

ALTER POLICY "Admins delete design-formats"
ON storage.objects
USING (
  bucket_id = 'design-formats'
  AND auth.role() = 'authenticated'
);