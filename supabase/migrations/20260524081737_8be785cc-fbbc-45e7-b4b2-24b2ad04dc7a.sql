
-- 1. callback_settings: admin-only for all operations
DROP POLICY IF EXISTS "Authenticated users can view callback_settings" ON public.callback_settings;
DROP POLICY IF EXISTS "Authenticated users can insert callback_settings" ON public.callback_settings;
DROP POLICY IF EXISTS "Authenticated users can update callback_settings" ON public.callback_settings;
CREATE POLICY "Admins can view callback_settings" ON public.callback_settings FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can insert callback_settings" ON public.callback_settings FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update callback_settings" ON public.callback_settings FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete callback_settings" ON public.callback_settings FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- 2. orders: SELECT remains for authenticated workers; writes admin-only
DROP POLICY IF EXISTS "Authenticated users can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Authenticated users can update orders" ON public.orders;
DROP POLICY IF EXISTS "Authenticated users can delete orders" ON public.orders;
CREATE POLICY "Admins can insert orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete orders" ON public.orders FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- 3. production_tracking: SELECT remains for workers; writes admin-only
DROP POLICY IF EXISTS "Authenticated users can insert tracking" ON public.production_tracking;
DROP POLICY IF EXISTS "Authenticated users can update tracking" ON public.production_tracking;
DROP POLICY IF EXISTS "Authenticated users can delete tracking" ON public.production_tracking;
CREATE POLICY "Admins can insert tracking" ON public.production_tracking FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update tracking" ON public.production_tracking FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete tracking" ON public.production_tracking FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- 4. shipments: SELECT for workers; writes admin-only
DROP POLICY IF EXISTS "Authenticated users can insert shipments" ON public.shipments;
DROP POLICY IF EXISTS "Authenticated users can update shipments" ON public.shipments;
DROP POLICY IF EXISTS "Authenticated users can delete shipments" ON public.shipments;
CREATE POLICY "Admins can insert shipments" ON public.shipments FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update shipments" ON public.shipments FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete shipments" ON public.shipments FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- 5. qr_*_master: SELECT for workers; writes admin-only
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['qr_tshirt_master','qr_design_master','qr_hologram_master','qr_silicon_master']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Auth insert %1$s" ON public.%2$I', replace(t,'_master',''), t);
    EXECUTE format('DROP POLICY IF EXISTS "Auth update %1$s" ON public.%2$I', replace(t,'_master',''), t);
    EXECUTE format('DROP POLICY IF EXISTS "Auth delete %1$s" ON public.%2$I', replace(t,'_master',''), t);
    EXECUTE format('CREATE POLICY "Admins insert %2$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY "Admins update %2$s" ON public.%1$I FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY "Admins delete %2$s" ON public.%1$I FOR DELETE TO authenticated USING (public.is_admin(auth.uid()))', t, t);
  END LOOP;
END $$;

-- 6. upload_history: scope to owner; admins can do all
DROP POLICY IF EXISTS "Authenticated users can view upload_history" ON public.upload_history;
DROP POLICY IF EXISTS "Authenticated users can insert upload_history" ON public.upload_history;
DROP POLICY IF EXISTS "Authenticated users can update upload_history" ON public.upload_history;
DROP POLICY IF EXISTS "Authenticated users can delete upload_history" ON public.upload_history;
CREATE POLICY "Users view own upload_history" ON public.upload_history FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "Users insert own upload_history" ON public.upload_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "Users update own upload_history" ON public.upload_history FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.is_admin(auth.uid())) WITH CHECK (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "Admins delete upload_history" ON public.upload_history FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- 7. webhook_logs: admin-only SELECT
DROP POLICY IF EXISTS "Authenticated users can view logs" ON public.webhook_logs;
CREATE POLICY "Admins view webhook_logs" ON public.webhook_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- 8. profiles privilege escalation defense: trigger preventing role/approved self-update by non-admin
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.approved IS DISTINCT FROM OLD.approved THEN
      RAISE EXCEPTION 'Not authorized to modify role or approval status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_prevent_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- 9. Revoke EXECUTE on is_admin from anon/authenticated (RLS uses it internally regardless)
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon, authenticated, public;
