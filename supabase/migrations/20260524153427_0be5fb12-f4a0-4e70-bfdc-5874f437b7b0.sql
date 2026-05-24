REVOKE EXECUTE ON FUNCTION app_private.is_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.is_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION app_private.is_admin(uuid) TO authenticated;