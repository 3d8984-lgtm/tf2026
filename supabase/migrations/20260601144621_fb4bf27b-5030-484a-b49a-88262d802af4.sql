-- Fix conflicting and incomplete storage RLS policies for heat-transfer order uploads.
-- The previous simple policies only checked bucket_id and caused inconsistent behavior.
DROP POLICY IF EXISTS "Authenticated insert hologram-pdf" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update hologram-pdf" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete hologram-pdf" ON storage.objects;
DROP POLICY IF EXISTS "Approved upload hologram-pdf" ON storage.objects;
DROP POLICY IF EXISTS "Approved update hologram-pdf" ON storage.objects;
DROP POLICY IF EXISTS "Approved delete hologram-pdf" ON storage.objects;

CREATE POLICY "Approved users can upload hologram-pdf files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'hologram-pdf'
  AND (
    app_private.is_approved(auth.uid())
    OR app_private.is_admin(auth.uid())
  )
);

CREATE POLICY "Approved users can update hologram-pdf files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'hologram-pdf'
  AND (
    app_private.is_approved(auth.uid())
    OR app_private.is_admin(auth.uid())
  )
)
WITH CHECK (
  bucket_id = 'hologram-pdf'
  AND (
    app_private.is_approved(auth.uid())
    OR app_private.is_admin(auth.uid())
  )
);

CREATE POLICY "Approved users can delete hologram-pdf files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'hologram-pdf'
  AND (
    app_private.is_approved(auth.uid())
    OR app_private.is_admin(auth.uid())
  )
);

-- Align outsource_order_jobs with the project's schema-qualified auth helpers.
DROP POLICY IF EXISTS "Admins delete jobs" ON public.outsource_order_jobs;
DROP POLICY IF EXISTS "Admins insert jobs" ON public.outsource_order_jobs;
DROP POLICY IF EXISTS "Admins update jobs" ON public.outsource_order_jobs;
DROP POLICY IF EXISTS "Approved view jobs" ON public.outsource_order_jobs;

CREATE POLICY "Admins delete jobs"
ON public.outsource_order_jobs
FOR DELETE
TO authenticated
USING (app_private.is_admin(auth.uid()));

CREATE POLICY "Admins insert jobs"
ON public.outsource_order_jobs
FOR INSERT
TO authenticated
WITH CHECK (app_private.is_admin(auth.uid()));

CREATE POLICY "Admins update jobs"
ON public.outsource_order_jobs
FOR UPDATE
TO authenticated
USING (app_private.is_admin(auth.uid()))
WITH CHECK (app_private.is_admin(auth.uid()));

CREATE POLICY "Approved view jobs"
ON public.outsource_order_jobs
FOR SELECT
TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outsource_order_jobs TO authenticated;
GRANT ALL ON public.outsource_order_jobs TO service_role;