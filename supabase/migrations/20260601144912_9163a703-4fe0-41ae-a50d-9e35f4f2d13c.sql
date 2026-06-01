-- Supabase Storage upsert uploads need read visibility on the target bucket/object path.
-- Without this, uploads with x-upsert=true can fail with "new row violates row-level security policy".
DROP POLICY IF EXISTS "Approved users can read hologram-pdf files" ON storage.objects;

CREATE POLICY "Approved users can read hologram-pdf files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'hologram-pdf'
  AND (
    app_private.is_approved(auth.uid())
    OR app_private.is_admin(auth.uid())
  )
);