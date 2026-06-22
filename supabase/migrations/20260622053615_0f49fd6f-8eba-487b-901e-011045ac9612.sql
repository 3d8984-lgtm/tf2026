CREATE TABLE public.cameras (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT,
    stream_url TEXT NOT NULL,
    webrtc_url TEXT,
    recording_base_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cameras TO authenticated;
GRANT ALL ON public.cameras TO service_role;

ALTER TABLE public.cameras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users full access to cameras" ON public.cameras
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_cameras_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_cameras_updated_at
    BEFORE UPDATE ON public.cameras
    FOR EACH ROW
    EXECUTE FUNCTION public.update_cameras_updated_at();
