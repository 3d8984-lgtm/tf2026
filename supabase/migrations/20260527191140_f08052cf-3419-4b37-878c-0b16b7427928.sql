ALTER POLICY "Admins insert design-formats"
ON storage.objects
WITH CHECK (
  bucket_id = 'design-formats'
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.user_id = auth.uid()
      AND profiles.role = 'admin'
      AND profiles.approved = true
  )
);

ALTER POLICY "Admins update design-formats"
ON storage.objects
USING (
  bucket_id = 'design-formats'
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.user_id = auth.uid()
      AND profiles.role = 'admin'
      AND profiles.approved = true
  )
)
WITH CHECK (
  bucket_id = 'design-formats'
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.user_id = auth.uid()
      AND profiles.role = 'admin'
      AND profiles.approved = true
  )
);

ALTER POLICY "Admins delete design-formats"
ON storage.objects
USING (
  bucket_id = 'design-formats'
  AND EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.user_id = auth.uid()
      AND profiles.role = 'admin'
      AND profiles.approved = true
  )
);