
CREATE POLICY "silicon_examples_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'silicon-examples' AND public.is_approved(auth.uid()));
CREATE POLICY "silicon_examples_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'silicon-examples' AND public.is_approved(auth.uid()));
CREATE POLICY "silicon_examples_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'silicon-examples' AND public.is_approved(auth.uid())) WITH CHECK (bucket_id = 'silicon-examples' AND public.is_approved(auth.uid()));
CREATE POLICY "silicon_examples_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'silicon-examples' AND public.is_approved(auth.uid()));
