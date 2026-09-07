ALTER TABLE public.app_ui_settings REPLICA IDENTITY FULL;
DO $$ BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.app_ui_settings';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP POLICY IF EXISTS app_ui_settings_select ON public.app_ui_settings;
CREATE POLICY app_ui_settings_select ON public.app_ui_settings FOR SELECT TO authenticated USING (true);