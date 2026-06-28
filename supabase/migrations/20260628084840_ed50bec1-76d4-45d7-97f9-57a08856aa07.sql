CREATE POLICY "Approved users read own files in upload-files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'upload-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()))
);