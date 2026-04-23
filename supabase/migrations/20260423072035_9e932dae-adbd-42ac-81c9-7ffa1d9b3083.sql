-- Add logo_url column to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS logo_url text;

-- Create storage bucket for order logos
INSERT INTO storage.buckets (id, name, public) VALUES ('order-logos', 'order-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for order-logos bucket
CREATE POLICY "Anyone can view order logos" ON storage.objects FOR SELECT USING (bucket_id = 'order-logos');
CREATE POLICY "Authenticated users can upload order logos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'order-logos' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete order logos" ON storage.objects FOR DELETE USING (bucket_id = 'order-logos' AND auth.role() = 'authenticated');