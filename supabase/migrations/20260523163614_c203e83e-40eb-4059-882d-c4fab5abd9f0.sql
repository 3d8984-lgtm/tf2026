CREATE TABLE IF NOT EXISTS public.user_ui_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  setting_key text NOT NULL,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_ui_settings_user_key_unique UNIQUE (user_id, setting_key)
);

ALTER TABLE public.user_ui_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own UI settings"
ON public.user_ui_settings
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own UI settings"
ON public.user_ui_settings
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own UI settings"
ON public.user_ui_settings
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own UI settings"
ON public.user_ui_settings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_ui_settings_user_key
ON public.user_ui_settings (user_id, setting_key);

CREATE TRIGGER update_user_ui_settings_updated_at
BEFORE UPDATE ON public.user_ui_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();