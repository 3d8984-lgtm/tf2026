DROP POLICY IF EXISTS "Authenticated read hologram-pdf" ON storage.objects;

CREATE POLICY "Authenticated read hologram-pdf"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'hologram-pdf' AND name = 'format.pdf');