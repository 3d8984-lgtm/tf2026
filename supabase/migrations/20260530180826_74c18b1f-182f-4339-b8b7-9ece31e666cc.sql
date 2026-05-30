DROP POLICY IF EXISTS "Authenticated can list design-formats" ON storage.objects;

CREATE POLICY "Authenticated can read design-formats app folders"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'design-formats'
  AND (
    name LIKE 'heat-transfer/%'
    OR name LIKE 'nfc-card-test/%'
  )
);