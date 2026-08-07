CREATE TABLE public.work_video_records (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'work-videos',
  path text not null unique,
  order_id uuid,
  external_order_id text,
  item_no text,
  has_defect boolean not null default false,
  retain boolean not null default false,
  size_bytes bigint,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE ON public.work_video_records TO authenticated;
GRANT ALL ON public.work_video_records TO service_role;
ALTER TABLE public.work_video_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wvr_select_approved" ON public.work_video_records FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "wvr_insert_approved" ON public.work_video_records FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "wvr_update_approved" ON public.work_video_records FOR UPDATE TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "wvr_delete_admin" ON public.work_video_records FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER trg_wvr_updated BEFORE UPDATE ON public.work_video_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_wvr_created ON public.work_video_records (created_at);

CREATE TABLE public.work_video_settings (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default true,
  retention_days integer not null default 90,
  keep_defects boolean not null default true,
  last_run_at timestamptz,
  last_run_deleted integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT ON public.work_video_settings TO authenticated;
GRANT ALL ON public.work_video_settings TO service_role;
ALTER TABLE public.work_video_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wvs_select_approved" ON public.work_video_settings FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "wvs_admin_all" ON public.work_video_settings FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
GRANT INSERT, UPDATE, DELETE ON public.work_video_settings TO authenticated;
CREATE TRIGGER trg_wvs_updated BEFORE UPDATE ON public.work_video_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.work_video_settings (enabled, retention_days, keep_defects) VALUES (true, 90, true);