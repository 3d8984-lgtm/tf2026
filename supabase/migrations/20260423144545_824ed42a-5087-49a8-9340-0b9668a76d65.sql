
-- T-shirt QR master
CREATE TABLE public.qr_tshirt_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_value text NOT NULL UNIQUE,
  color text NOT NULL,
  size text NOT NULL,
  product_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qr_tshirt_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth select qr_tshirt" ON public.qr_tshirt_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert qr_tshirt" ON public.qr_tshirt_master FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update qr_tshirt" ON public.qr_tshirt_master FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete qr_tshirt" ON public.qr_tshirt_master FOR DELETE TO authenticated USING (true);
CREATE TRIGGER update_qr_tshirt_updated_at BEFORE UPDATE ON public.qr_tshirt_master FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Silicon QR master
CREATE TABLE public.qr_silicon_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_value text NOT NULL UNIQUE,
  serial_number text NOT NULL,
  product_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qr_silicon_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth select qr_silicon" ON public.qr_silicon_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert qr_silicon" ON public.qr_silicon_master FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update qr_silicon" ON public.qr_silicon_master FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete qr_silicon" ON public.qr_silicon_master FOR DELETE TO authenticated USING (true);
CREATE TRIGGER update_qr_silicon_updated_at BEFORE UPDATE ON public.qr_silicon_master FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Design QR master
CREATE TABLE public.qr_design_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_value text NOT NULL UNIQUE,
  design_code text NOT NULL,
  design_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qr_design_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth select qr_design" ON public.qr_design_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert qr_design" ON public.qr_design_master FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update qr_design" ON public.qr_design_master FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete qr_design" ON public.qr_design_master FOR DELETE TO authenticated USING (true);
CREATE TRIGGER update_qr_design_updated_at BEFORE UPDATE ON public.qr_design_master FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Hologram QR master
CREATE TABLE public.qr_hologram_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_value text NOT NULL UNIQUE,
  serial_number text NOT NULL,
  hologram_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qr_hologram_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth select qr_hologram" ON public.qr_hologram_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert qr_hologram" ON public.qr_hologram_master FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update qr_hologram" ON public.qr_hologram_master FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete qr_hologram" ON public.qr_hologram_master FOR DELETE TO authenticated USING (true);
CREATE TRIGGER update_qr_hologram_updated_at BEFORE UPDATE ON public.qr_hologram_master FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
