DROP POLICY IF EXISTS "Authenticated can read design-formats app folders" ON storage.objects;
CREATE POLICY "Authenticated can read design-formats app folders"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'design-formats'
  AND (
    name LIKE 'heat-transfer/%'
    OR name LIKE 'nfc-card-test/%'
    OR name LIKE 'nfc-card-test-back-grade/%'
    OR name LIKE 'nfc-card-test-shape-grade/%'
    OR name LIKE 'nfc-card-signature-edits/%'
  )
  AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()))
);

DROP POLICY IF EXISTS "Authenticated read hologram-pdf" ON storage.objects;
CREATE POLICY "Authenticated read hologram-pdf"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'hologram-pdf'
  AND name = 'format.pdf'
  AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()))
);