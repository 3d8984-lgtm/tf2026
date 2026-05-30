GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Admins can upload silicon templates" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update silicon templates" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete silicon templates" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view silicon templates" ON storage.objects;

CREATE POLICY "Admins can upload silicon templates"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'silicon-templates' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins can update silicon templates"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'silicon-templates' AND app_private.is_admin(auth.uid()))
WITH CHECK (bucket_id = 'silicon-templates' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins can delete silicon templates"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'silicon-templates' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins can view silicon templates"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'silicon-templates' AND app_private.is_admin(auth.uid()));