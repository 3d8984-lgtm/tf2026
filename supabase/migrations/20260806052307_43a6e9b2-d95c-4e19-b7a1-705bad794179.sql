GRANT EXECUTE ON FUNCTION app_private.is_approved(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_admin(uuid) TO authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated;