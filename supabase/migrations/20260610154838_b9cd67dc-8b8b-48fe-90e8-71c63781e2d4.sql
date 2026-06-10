
-- 1. shipments scan-related columns
DO $$ BEGIN
  CREATE TYPE public.scan_status AS ENUM ('pending','scanning','ready','shipped','reported');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS scan_status public.scan_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scanned_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS design_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracking_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS reported_at timestamptz;

-- 2. shipment_scan_items
CREATE TABLE IF NOT EXISTS public.shipment_scan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  position integer NOT NULL,
  qr_value text,
  product_code text,
  color text,
  size text,
  design_image_url text,
  is_scanned boolean NOT NULL DEFAULT false,
  scanned_at timestamptz,
  scanned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, position)
);
CREATE INDEX IF NOT EXISTS idx_scan_items_shipment ON public.shipment_scan_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_scan_items_order ON public.shipment_scan_items(order_id);
CREATE INDEX IF NOT EXISTS idx_scan_items_qr ON public.shipment_scan_items(qr_value);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_scan_items TO authenticated;
GRANT ALL ON public.shipment_scan_items TO service_role;
ALTER TABLE public.shipment_scan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read scan_items" ON public.shipment_scan_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert scan_items" ON public.shipment_scan_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update scan_items" ON public.shipment_scan_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins delete scan_items" ON public.shipment_scan_items FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_scan_items_updated_at BEFORE UPDATE ON public.shipment_scan_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. shipping_logs
CREATE TABLE IF NOT EXISTS public.shipping_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  worker_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipping_logs_shipment ON public.shipping_logs(shipment_id);

GRANT SELECT, INSERT ON public.shipping_logs TO authenticated;
GRANT ALL ON public.shipping_logs TO service_role;
ALTER TABLE public.shipping_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read shipping_logs" ON public.shipping_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert shipping_logs" ON public.shipping_logs FOR INSERT TO authenticated WITH CHECK (true);

-- 4. Auto-create scan slots when shipment is created
CREATE OR REPLACE FUNCTION public.create_shipment_scan_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  i integer;
BEGIN
  SELECT quantity, product_code, logo_url INTO o FROM public.orders WHERE id = NEW.order_id;
  IF o.quantity IS NULL OR o.quantity <= 0 THEN
    RETURN NEW;
  END IF;
  FOR i IN 1..o.quantity LOOP
    INSERT INTO public.shipment_scan_items (shipment_id, order_id, position, product_code, design_image_url)
    VALUES (NEW.id, NEW.order_id, i, o.product_code, o.logo_url)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_scan_slots ON public.shipments;
CREATE TRIGGER trg_create_scan_slots
AFTER INSERT ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.create_shipment_scan_slots();

-- 5. Backfill existing shipments
INSERT INTO public.shipment_scan_items (shipment_id, order_id, position, product_code, design_image_url)
SELECT s.id, s.order_id, gs.i, o.product_code, o.logo_url
FROM public.shipments s
JOIN public.orders o ON o.id = s.order_id
CROSS JOIN LATERAL generate_series(1, GREATEST(o.quantity,1)) AS gs(i)
WHERE NOT EXISTS (SELECT 1 FROM public.shipment_scan_items si WHERE si.shipment_id = s.id);
