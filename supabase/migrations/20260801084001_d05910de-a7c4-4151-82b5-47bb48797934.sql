CREATE POLICY "Approved users can read card-frames"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'card-frames' AND public.is_approved(auth.uid()));

CREATE POLICY "Approved users can read twincode-images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'twincode-images' AND public.is_approved(auth.uid()));