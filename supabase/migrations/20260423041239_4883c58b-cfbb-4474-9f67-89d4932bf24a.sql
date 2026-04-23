-- Upload history table
CREATE TABLE public.upload_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  user_email text,
  user_id uuid,
  file_path text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view upload_history"
  ON public.upload_history FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert upload_history"
  ON public.upload_history FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete upload_history"
  ON public.upload_history FOR DELETE TO authenticated
  USING (true);

-- Storage bucket for uploaded Excel files
INSERT INTO storage.buckets (id, name, public) VALUES ('upload-files', 'upload-files', false);

CREATE POLICY "Authenticated users can upload files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'upload-files');

CREATE POLICY "Authenticated users can read files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'upload-files');

CREATE POLICY "Authenticated users can delete files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'upload-files');