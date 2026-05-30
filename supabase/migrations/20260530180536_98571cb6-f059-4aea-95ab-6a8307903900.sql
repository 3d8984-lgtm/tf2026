DROP POLICY IF EXISTS "hologram-pdf public read" ON storage.objects;
DROP POLICY IF EXISTS "hologram-pdf admin insert" ON storage.objects;
DROP POLICY IF EXISTS "hologram-pdf admin update" ON storage.objects;
DROP POLICY IF EXISTS "hologram-pdf admin delete" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read hologram-pdf" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated insert hologram-pdf" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update hologram-pdf" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete hologram-pdf" ON storage.objects;

CREATE POLICY "Authenticated read hologram-pdf"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'hologram-pdf');

CREATE POLICY "Authenticated insert hologram-pdf"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'hologram-pdf');

CREATE POLICY "Authenticated update hologram-pdf"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'hologram-pdf')
WITH CHECK (bucket_id = 'hologram-pdf');

CREATE POLICY "Authenticated delete hologram-pdf"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'hologram-pdf');