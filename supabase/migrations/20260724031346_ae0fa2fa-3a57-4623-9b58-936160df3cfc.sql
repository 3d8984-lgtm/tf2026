
CREATE TABLE public.cctv_camera_settings (
  camera_id text PRIMARY KEY,
  display_name text,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cctv_camera_settings TO authenticated;
GRANT ALL ON public.cctv_camera_settings TO service_role;

ALTER TABLE public.cctv_camera_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can view cctv settings"
ON public.cctv_camera_settings FOR SELECT
TO authenticated
USING (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can upsert cctv settings"
ON public.cctv_camera_settings FOR INSERT
TO authenticated
WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can update cctv settings"
ON public.cctv_camera_settings FOR UPDATE
TO authenticated
USING (public.is_approved(auth.uid()))
WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Admins can delete cctv settings"
ON public.cctv_camera_settings FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_cctv_camera_settings_updated_at
BEFORE UPDATE ON public.cctv_camera_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
