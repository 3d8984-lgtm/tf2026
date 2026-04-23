ALTER TABLE public.upload_history
ADD COLUMN design_image_count integer NOT NULL DEFAULT 0,
ADD COLUMN twincode_image_count integer NOT NULL DEFAULT 0;