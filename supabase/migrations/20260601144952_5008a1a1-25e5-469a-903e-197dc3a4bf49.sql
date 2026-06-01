-- Public helper functions are no longer needed by current policies.
-- Revoke direct execution to remove security-definer linter warnings.
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon, authenticated;