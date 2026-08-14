DROP POLICY IF EXISTS app_ui_settings_insert ON public.app_ui_settings;
DROP POLICY IF EXISTS app_ui_settings_update ON public.app_ui_settings;

CREATE POLICY app_ui_settings_insert ON public.app_ui_settings
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_approved(auth.uid()));

CREATE POLICY app_ui_settings_update ON public.app_ui_settings
  FOR UPDATE TO authenticated
  USING (app_private.is_approved(auth.uid()))
  WITH CHECK (app_private.is_approved(auth.uid()));