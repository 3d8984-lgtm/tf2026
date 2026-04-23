
-- Create design-images storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('design-images', 'design-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
CREATE POLICY "Design images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'design-images');

-- Authenticated users can upload
CREATE POLICY "Authenticated users can upload design images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'design-images');

-- Authenticated users can update
CREATE POLICY "Authenticated users can update design images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'design-images');

-- Authenticated users can delete
CREATE POLICY "Authenticated users can delete design images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'design-images');
