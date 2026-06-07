
CREATE POLICY "tshirt_po_att_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'tshirt-po-attachments');
CREATE POLICY "tshirt_po_att_write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'tshirt-po-attachments');
CREATE POLICY "tshirt_po_att_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'tshirt-po-attachments');
CREATE POLICY "tshirt_po_att_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'tshirt-po-attachments');
