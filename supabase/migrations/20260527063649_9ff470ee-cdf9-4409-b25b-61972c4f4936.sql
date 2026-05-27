
INSERT INTO storage.buckets (id, name, public) VALUES ('card-frames', 'card-frames', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read card-frames"
ON storage.objects FOR SELECT
USING (bucket_id = 'card-frames');

CREATE POLICY "Authenticated insert card-frames"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'card-frames');

CREATE POLICY "Authenticated update card-frames"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'card-frames');

CREATE POLICY "Authenticated delete card-frames"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'card-frames');
