
-- QR master read restriction
DROP POLICY IF EXISTS "Authenticated users can view qr_tshirt_master" ON public.qr_tshirt_master;
DROP POLICY IF EXISTS "Authenticated can view qr_tshirt_master" ON public.qr_tshirt_master;
DROP POLICY IF EXISTS "Anyone authenticated can view qr_tshirt_master" ON public.qr_tshirt_master;
CREATE POLICY "Approved users can view qr_tshirt_master" ON public.qr_tshirt_master
  FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view qr_hologram_master" ON public.qr_hologram_master;
DROP POLICY IF EXISTS "Authenticated can view qr_hologram_master" ON public.qr_hologram_master;
CREATE POLICY "Approved users can view qr_hologram_master" ON public.qr_hologram_master
  FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view qr_silicon_master" ON public.qr_silicon_master;
DROP POLICY IF EXISTS "Authenticated can view qr_silicon_master" ON public.qr_silicon_master;
CREATE POLICY "Approved users can view qr_silicon_master" ON public.qr_silicon_master
  FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view qr_design_master" ON public.qr_design_master;
DROP POLICY IF EXISTS "Authenticated can view qr_design_master" ON public.qr_design_master;
CREATE POLICY "Approved users can view qr_design_master" ON public.qr_design_master
  FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

-- tshirt_colors / tshirt_product_types read restriction
DROP POLICY IF EXISTS "Authenticated users can view tshirt_colors" ON public.tshirt_colors;
DROP POLICY IF EXISTS "Authenticated can view tshirt_colors" ON public.tshirt_colors;
CREATE POLICY "Approved users can view tshirt_colors" ON public.tshirt_colors
  FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view tshirt_product_types" ON public.tshirt_product_types;
DROP POLICY IF EXISTS "Authenticated can view tshirt_product_types" ON public.tshirt_product_types;
CREATE POLICY "Approved users can view tshirt_product_types" ON public.tshirt_product_types
  FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()) OR public.is_admin(auth.uid()));

-- upload_history insert/update approval
DROP POLICY IF EXISTS "Users can insert their own upload history" ON public.upload_history;
DROP POLICY IF EXISTS "Users can update their own upload history" ON public.upload_history;
CREATE POLICY "Approved users can insert their own upload history" ON public.upload_history
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));
CREATE POLICY "Approved users can update their own upload history" ON public.upload_history
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())))
  WITH CHECK (auth.uid() = user_id AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));

-- Storage: design-formats bucket
DROP POLICY IF EXISTS "Authenticated users can upload design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update design-formats" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete design-formats" ON storage.objects;
CREATE POLICY "Approved users can upload design-formats" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'design-formats' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));
CREATE POLICY "Approved users can update design-formats" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'design-formats' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())))
  WITH CHECK (bucket_id = 'design-formats' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));
CREATE POLICY "Approved users can delete design-formats" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'design-formats' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));

-- Storage: order-logos bucket - add missing UPDATE policy
DROP POLICY IF EXISTS "Approved users can update order-logos" ON storage.objects;
CREATE POLICY "Approved users can update order-logos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'order-logos' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())))
  WITH CHECK (bucket_id = 'order-logos' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));
