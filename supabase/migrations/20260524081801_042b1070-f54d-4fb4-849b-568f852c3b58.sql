
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_escalation() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.auto_create_order_related() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_tracking_update() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
