
DROP POLICY IF EXISTS "Authenticated users can view shipments" ON public.shipments;
CREATE POLICY "Approved users can view shipments" ON public.shipments
FOR SELECT TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view tracking" ON public.production_tracking;
CREATE POLICY "Approved users can view tracking" ON public.production_tracking
FOR SELECT TO authenticated
USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "tshirt_inventory_all_auth" ON public.tshirt_inventory;
CREATE POLICY "tshirt_inventory_approved_read" ON public.tshirt_inventory FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_inventory_approved_write" ON public.tshirt_inventory FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_inventory_approved_update" ON public.tshirt_inventory FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_inventory_admin_delete" ON public.tshirt_inventory FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage tshirt work logs" ON public.tshirt_work_logs;
CREATE POLICY "tshirt_work_logs_approved_read" ON public.tshirt_work_logs FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_work_logs_approved_write" ON public.tshirt_work_logs FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_work_logs_approved_update" ON public.tshirt_work_logs FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_work_logs_admin_delete" ON public.tshirt_work_logs FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "tshirt_po_all_auth" ON public.tshirt_purchase_orders;
CREATE POLICY "tshirt_po_approved_read" ON public.tshirt_purchase_orders FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_approved_write" ON public.tshirt_purchase_orders FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_approved_update" ON public.tshirt_purchase_orders FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_admin_delete" ON public.tshirt_purchase_orders FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "tshirt_po_items_all_auth" ON public.tshirt_purchase_order_items;
CREATE POLICY "tshirt_po_items_approved_read" ON public.tshirt_purchase_order_items FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_items_approved_write" ON public.tshirt_purchase_order_items FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_items_approved_update" ON public.tshirt_purchase_order_items FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_items_admin_delete" ON public.tshirt_purchase_order_items FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "tshirt_po_att_all_auth" ON public.tshirt_purchase_order_attachments;
CREATE POLICY "tshirt_po_att_t_approved_read" ON public.tshirt_purchase_order_attachments FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_att_t_approved_write" ON public.tshirt_purchase_order_attachments FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_att_t_approved_update" ON public.tshirt_purchase_order_attachments FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "tshirt_po_att_t_admin_delete" ON public.tshirt_purchase_order_attachments FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can upload order logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete order logos" ON storage.objects;
CREATE POLICY "Approved users can upload order logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'order-logos' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "Approved users can delete order logos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'order-logos' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

DROP POLICY IF EXISTS "tshirt_po_att_read"   ON storage.objects;
DROP POLICY IF EXISTS "tshirt_po_att_write"  ON storage.objects;
DROP POLICY IF EXISTS "tshirt_po_att_update" ON storage.objects;
DROP POLICY IF EXISTS "tshirt_po_att_delete" ON storage.objects;
CREATE POLICY "tshirt_po_att_read"   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'tshirt-po-attachments' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "tshirt_po_att_write"  ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'tshirt-po-attachments' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "tshirt_po_att_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'tshirt-po-attachments' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()))) WITH CHECK (bucket_id = 'tshirt-po-attachments' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));
CREATE POLICY "tshirt_po_att_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'tshirt-po-attachments' AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

DROP POLICY IF EXISTS "Users upload to own folder in upload-files" ON storage.objects;
CREATE POLICY "Approved users upload to own folder in upload-files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'upload-files' AND (auth.uid())::text = (storage.foldername(name))[1] AND (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())));

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved users can receive realtime messages" ON realtime.messages;
CREATE POLICY "Approved users can receive realtime messages" ON realtime.messages FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid)    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                      FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_create_order_related()            FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_tracking_update()               FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_escalation() FROM anon, authenticated, PUBLIC;
