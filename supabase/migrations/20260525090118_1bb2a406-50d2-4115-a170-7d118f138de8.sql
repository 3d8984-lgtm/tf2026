
-- Helper: approved user check
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id AND approved = true
  )
$$;

-- Tighten orders SELECT
DROP POLICY IF EXISTS "Authenticated users can view orders" ON public.orders;
CREATE POLICY "Approved users can view orders"
ON public.orders FOR SELECT TO authenticated
USING (public.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

-- design-images: admin-only writes
DROP POLICY IF EXISTS "Authenticated users can upload design images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update design images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete design images" ON storage.objects;

CREATE POLICY "Admins upload design images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'design-images' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins update design images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'design-images' AND app_private.is_admin(auth.uid()))
WITH CHECK (bucket_id = 'design-images' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins delete design images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'design-images' AND app_private.is_admin(auth.uid()));

-- twincode-images: admin-only writes
DROP POLICY IF EXISTS "Authenticated users can upload twincode images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update twincode images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete twincode images" ON storage.objects;

CREATE POLICY "Admins upload twincode images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'twincode-images' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins update twincode images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'twincode-images' AND app_private.is_admin(auth.uid()))
WITH CHECK (bucket_id = 'twincode-images' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins delete twincode images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'twincode-images' AND app_private.is_admin(auth.uid()));

-- upload-files: admin-only read and delete
DROP POLICY IF EXISTS "Authenticated users can read files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete files" ON storage.objects;

CREATE POLICY "Admins read upload files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'upload-files' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins delete upload files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'upload-files' AND app_private.is_admin(auth.uid()));
