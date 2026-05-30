CREATE POLICY "Admins can upload silicon templates"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'silicon-templates' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can update silicon templates"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'silicon-templates' AND public.is_admin(auth.uid()))
WITH CHECK (bucket_id = 'silicon-templates' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete silicon templates"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'silicon-templates' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can view silicon templates"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'silicon-templates' AND public.is_admin(auth.uid()));