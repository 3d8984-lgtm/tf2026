DROP POLICY IF EXISTS silicon_examples_insert ON storage.objects;
CREATE POLICY silicon_examples_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'silicon-examples'
  AND app_private.is_approved(auth.uid())
  AND owner = auth.uid()
  AND (owner_id IS NULL OR owner_id = auth.uid()::text)
);