
INSERT INTO storage.buckets (id, name, public) 
VALUES ('silicon-templates', 'silicon-templates', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can view own silicon templates"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'silicon-templates' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload own silicon templates"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'silicon-templates' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own silicon templates"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'silicon-templates' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own silicon templates"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'silicon-templates' AND auth.uid()::text = (storage.foldername(name))[1]);
