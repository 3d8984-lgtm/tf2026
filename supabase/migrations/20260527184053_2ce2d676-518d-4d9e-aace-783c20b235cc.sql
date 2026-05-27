
-- 1) card-frames: restrict writes to admins
DROP POLICY IF EXISTS "Authenticated insert card-frames" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update card-frames" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete card-frames" ON storage.objects;

CREATE POLICY "Admins insert card-frames" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'card-frames' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins update card-frames" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'card-frames' AND app_private.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'card-frames' AND app_private.is_admin(auth.uid()));

CREATE POLICY "Admins delete card-frames" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'card-frames' AND app_private.is_admin(auth.uid()));

-- 2) card-frames: remove broad listing policy. Public bucket files remain reachable via public URL/CDN.
DROP POLICY IF EXISTS "Public read card-frames" ON storage.objects;

-- 3) upload-files: scope INSERT to user's own folder
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;

CREATE POLICY "Users upload to own folder in upload-files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'upload-files'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

-- 4) Lock down SECURITY DEFINER helper functions: revoke direct EXECUTE
REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
