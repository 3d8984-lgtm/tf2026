CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = _user_id
      AND role = 'admin'
      AND approved = true
  )
$$;

GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_admin(uuid) TO authenticated;

ALTER POLICY "Admins can delete callback_settings" ON public.callback_settings USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can insert callback_settings" ON public.callback_settings WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can update callback_settings" ON public.callback_settings USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can view callback_settings" ON public.callback_settings USING (app_private.is_admin(auth.uid()));

ALTER POLICY "Admins can delete orders" ON public.orders USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can insert orders" ON public.orders WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can update orders" ON public.orders USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));

ALTER POLICY "Admins can delete tracking" ON public.production_tracking USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can insert tracking" ON public.production_tracking WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can update tracking" ON public.production_tracking USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));

ALTER POLICY "Admin can read all profiles" ON public.profiles USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admin can update profiles" ON public.profiles USING (app_private.is_admin(auth.uid()));

ALTER POLICY "Admins delete qr_design_master" ON public.qr_design_master USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins insert qr_design_master" ON public.qr_design_master WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins update qr_design_master" ON public.qr_design_master USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));

ALTER POLICY "Admins delete qr_hologram_master" ON public.qr_hologram_master USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins insert qr_hologram_master" ON public.qr_hologram_master WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins update qr_hologram_master" ON public.qr_hologram_master USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));

ALTER POLICY "Admins delete qr_silicon_master" ON public.qr_silicon_master USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins insert qr_silicon_master" ON public.qr_silicon_master WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins update qr_silicon_master" ON public.qr_silicon_master USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));

ALTER POLICY "Admins delete qr_tshirt_master" ON public.qr_tshirt_master USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins insert qr_tshirt_master" ON public.qr_tshirt_master WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins update qr_tshirt_master" ON public.qr_tshirt_master USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));

ALTER POLICY "Admins can delete shipments" ON public.shipments USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can insert shipments" ON public.shipments WITH CHECK (app_private.is_admin(auth.uid()));
ALTER POLICY "Admins can update shipments" ON public.shipments USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));

ALTER POLICY "Admins delete upload_history" ON public.upload_history USING (app_private.is_admin(auth.uid()));
ALTER POLICY "Users insert own upload_history" ON public.upload_history WITH CHECK ((auth.uid() = user_id) OR app_private.is_admin(auth.uid()));
ALTER POLICY "Users update own upload_history" ON public.upload_history USING ((auth.uid() = user_id) OR app_private.is_admin(auth.uid())) WITH CHECK ((auth.uid() = user_id) OR app_private.is_admin(auth.uid()));
ALTER POLICY "Users view own upload_history" ON public.upload_history USING ((auth.uid() = user_id) OR app_private.is_admin(auth.uid()));

ALTER POLICY "Admins view webhook_logs" ON public.webhook_logs USING (app_private.is_admin(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM authenticated;