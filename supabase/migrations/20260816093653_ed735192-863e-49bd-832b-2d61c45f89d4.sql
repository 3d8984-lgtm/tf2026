-- 1) courier_configs: restrict full config (API URLs/modes/test logs) to admins
DROP POLICY IF EXISTS "approved users can view couriers" ON public.courier_configs;
CREATE POLICY "admins can view couriers" ON public.courier_configs
FOR SELECT TO authenticated
USING (app_private.is_admin(auth.uid()));

-- Safe list for approved workers (no api_url / api_mode / test metadata)
CREATE OR REPLACE VIEW public.courier_configs_safe
WITH (security_invoker = false) AS
SELECT id, code, name, enabled, is_default, has_credentials, sort_order
FROM public.courier_configs
WHERE app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid());

GRANT SELECT ON public.courier_configs_safe TO authenticated;
GRANT ALL ON public.courier_configs_safe TO service_role;

-- 2) profiles: explicit admin-only delete
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
CREATE POLICY "Admins can delete profiles" ON public.profiles
FOR DELETE TO authenticated
USING (app_private.is_admin(auth.uid()));

-- 3) shipping_groups / shipment_scan_items: restrict row creation to admins
DROP POLICY IF EXISTS "Approved insert shipping_groups" ON public.shipping_groups;
CREATE POLICY "Admins insert shipping_groups" ON public.shipping_groups
FOR INSERT TO authenticated
WITH CHECK (app_private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Approved insert scan_items" ON public.shipment_scan_items;
CREATE POLICY "Admins insert scan_items" ON public.shipment_scan_items
FOR INSERT TO authenticated
WITH CHECK (app_private.is_admin(auth.uid()));