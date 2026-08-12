CREATE TABLE IF NOT EXISTS public.inspection_roi_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_roi_settings TO authenticated;
GRANT ALL ON public.inspection_roi_settings TO service_role;

ALTER TABLE public.inspection_roi_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inspection ROI settings"
ON public.inspection_roi_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert inspection ROI settings"
ON public.inspection_roi_settings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update inspection ROI settings"
ON public.inspection_roi_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete inspection ROI settings"
ON public.inspection_roi_settings FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_inspection_roi_settings_updated_at
BEFORE UPDATE ON public.inspection_roi_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();