
-- Public buckets serve files via direct URL without needing storage.objects SELECT policies.
-- Removing the broad SELECT policies prevents listing while keeping public URL access intact.
DROP POLICY IF EXISTS "Anyone can view order logos" ON storage.objects;
DROP POLICY IF EXISTS "Design images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Twincode images are publicly accessible" ON storage.objects;
