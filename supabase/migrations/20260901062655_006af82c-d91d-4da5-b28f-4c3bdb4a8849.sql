REVOKE EXECUTE ON FUNCTION public.list_couriers_safe() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_couriers_safe() TO service_role;