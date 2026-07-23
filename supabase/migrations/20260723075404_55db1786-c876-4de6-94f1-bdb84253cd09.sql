
-- 1) Restrict realtime.messages subscription to admins (app does not use broadcast/presence for regular users)
DROP POLICY IF EXISTS "Approved users can receive realtime messages" ON realtime.messages;
CREATE POLICY "Admins can receive realtime messages"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (app_private.is_admin(auth.uid()));

-- 2) Revoke execute on SECURITY DEFINER functions from public/anon/authenticated.
-- These are trigger functions or internal helpers; they should not be callable via the Data API/RPC.
DO $$
DECLARE
  fn text;
BEGIN
  FOR fn IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'auto_create_order_related',
        'apply_tshirt_po_receipt',
        'prevent_profile_privilege_escalation',
        'sync_order_qr_to_master',
        'create_shipment_scan_slots',
        'handle_new_user',
        'notify_tracking_update',
        'is_admin',
        'is_approved'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;
