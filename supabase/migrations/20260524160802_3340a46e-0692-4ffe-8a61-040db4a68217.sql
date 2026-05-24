
INSERT INTO storage.buckets (id, name, public)
VALUES ('hologram-pdf', 'hologram-pdf', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "hologram-pdf public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'hologram-pdf');

CREATE POLICY "hologram-pdf admin insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'hologram-pdf' AND public.is_admin(auth.uid()));

CREATE POLICY "hologram-pdf admin update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'hologram-pdf' AND public.is_admin(auth.uid()));

CREATE POLICY "hologram-pdf admin delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'hologram-pdf' AND public.is_admin(auth.uid()));
