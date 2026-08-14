CREATE TABLE IF NOT EXISTS public.app_ui_settings (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_ui_settings TO authenticated;
GRANT ALL ON public.app_ui_settings TO service_role;

ALTER TABLE public.app_ui_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_ui_settings_select" ON public.app_ui_settings
  FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()));
CREATE POLICY "app_ui_settings_insert" ON public.app_ui_settings
  FOR INSERT TO authenticated WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "app_ui_settings_update" ON public.app_ui_settings
  FOR UPDATE TO authenticated USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "app_ui_settings_delete" ON public.app_ui_settings
  FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

CREATE TRIGGER app_ui_settings_updated_at BEFORE UPDATE ON public.app_ui_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();