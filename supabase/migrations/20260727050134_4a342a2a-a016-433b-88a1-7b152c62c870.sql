GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO service_role;