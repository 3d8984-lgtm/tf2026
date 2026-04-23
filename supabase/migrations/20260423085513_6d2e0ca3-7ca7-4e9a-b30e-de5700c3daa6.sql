
INSERT INTO storage.buckets (id, name, public)
VALUES ('twincode-images', 'twincode-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Twincode images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'twincode-images');

CREATE POLICY "Authenticated users can upload twincode images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'twincode-images');

CREATE POLICY "Authenticated users can update twincode images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'twincode-images');

CREATE POLICY "Authenticated users can delete twincode images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'twincode-images');
