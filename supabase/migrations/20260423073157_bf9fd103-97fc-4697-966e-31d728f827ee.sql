
ALTER TABLE public.upload_history ADD COLUMN IF NOT EXISTS logo_path text;

CREATE POLICY "Authenticated users can update upload_history"
ON public.upload_history
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
