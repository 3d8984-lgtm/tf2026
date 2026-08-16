DROP VIEW IF EXISTS public.courier_configs_safe;

CREATE OR REPLACE FUNCTION public.list_couriers_safe()
RETURNS TABLE (
  id uuid,
  code text,
  name text,
  enabled boolean,
  is_default boolean,
  has_credentials boolean,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.code, c.name, c.enabled, c.is_default, c.has_credentials, c.sort_order
  FROM public.courier_configs c
  WHERE app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid())
  ORDER BY c.sort_order;
$$;

REVOKE ALL ON FUNCTION public.list_couriers_safe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_couriers_safe() TO authenticated, service_role;