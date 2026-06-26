
-- cameras: replace permissive ALL policy
DROP POLICY IF EXISTS "Allow authenticated users full access to cameras" ON public.cameras;
CREATE POLICY "Approved users can view cameras" ON public.cameras
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));
CREATE POLICY "Admins manage cameras" ON public.cameras
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- qr_*: drop redundant open SELECT policies
DROP POLICY IF EXISTS "Auth select qr_design" ON public.qr_design_master;
DROP POLICY IF EXISTS "Auth select qr_hologram" ON public.qr_hologram_master;
DROP POLICY IF EXISTS "Auth select qr_silicon" ON public.qr_silicon_master;
DROP POLICY IF EXISTS "Auth select qr_tshirt" ON public.qr_tshirt_master;

-- shipment_scan_items: gate writes/reads behind approval
DROP POLICY IF EXISTS "Authenticated insert scan_items" ON public.shipment_scan_items;
DROP POLICY IF EXISTS "Authenticated update scan_items" ON public.shipment_scan_items;
DROP POLICY IF EXISTS "Authenticated read scan_items" ON public.shipment_scan_items;
CREATE POLICY "Approved read scan_items" ON public.shipment_scan_items
  FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));
CREATE POLICY "Approved insert scan_items" ON public.shipment_scan_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));
CREATE POLICY "Approved update scan_items" ON public.shipment_scan_items
  FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

-- shipping_logs: gate behind approval
DROP POLICY IF EXISTS "Authenticated read shipping_logs" ON public.shipping_logs;
DROP POLICY IF EXISTS "Authenticated insert shipping_logs" ON public.shipping_logs;
CREATE POLICY "Approved read shipping_logs" ON public.shipping_logs
  FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));
CREATE POLICY "Approved insert shipping_logs" ON public.shipping_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

-- tshirt reference tables: drop redundant open SELECT policies
DROP POLICY IF EXISTS "tshirt_colors_select_auth" ON public.tshirt_colors;
DROP POLICY IF EXISTS "tshirt_product_types_select_auth" ON public.tshirt_product_types;

-- silicon-templates storage: add approval gate to per-user policies
DROP POLICY IF EXISTS "Users can upload own silicon templates" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own silicon templates" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own silicon templates" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own silicon templates" ON storage.objects;

CREATE POLICY "Users can upload own silicon templates" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'silicon-templates'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()))
  );
CREATE POLICY "Users can view own silicon templates" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'silicon-templates'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()))
  );
CREATE POLICY "Users can update own silicon templates" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'silicon-templates'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()))
  );
CREATE POLICY "Users can delete own silicon templates" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'silicon-templates'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()))
  );

-- SECURITY DEFINER trigger functions should not be callable directly via Data API
REVOKE EXECUTE ON FUNCTION public.create_shipment_scan_slots() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_order_qr_to_master() FROM PUBLIC, anon, authenticated;
