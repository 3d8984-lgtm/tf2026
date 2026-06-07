
-- Enums
CREATE TYPE public.tshirt_size AS ENUM ('S','M','L','XL','2XL','3XL','4XL');
CREATE TYPE public.tshirt_po_status AS ENUM ('draft','ordered','in_production','received');

-- Product types master
CREATE TABLE public.tshirt_product_types (
  code TEXT PRIMARY KEY,
  name_ko TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_product_types TO authenticated;
GRANT ALL ON public.tshirt_product_types TO service_role;
ALTER TABLE public.tshirt_product_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tshirt_product_types_select_auth" ON public.tshirt_product_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "tshirt_product_types_modify_admin" ON public.tshirt_product_types FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Colors master
CREATE TABLE public.tshirt_colors (
  code TEXT PRIMARY KEY,
  name_ko TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  hex TEXT NOT NULL DEFAULT '#ffffff',
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_colors TO authenticated;
GRANT ALL ON public.tshirt_colors TO service_role;
ALTER TABLE public.tshirt_colors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tshirt_colors_select_auth" ON public.tshirt_colors FOR SELECT TO authenticated USING (true);
CREATE POLICY "tshirt_colors_modify_admin" ON public.tshirt_colors FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Inventory per SKU
CREATE TABLE public.tshirt_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type_code TEXT NOT NULL REFERENCES public.tshirt_product_types(code) ON DELETE CASCADE,
  color_code TEXT NOT NULL REFERENCES public.tshirt_colors(code) ON DELETE CASCADE,
  size public.tshirt_size NOT NULL,
  in_stock INT NOT NULL DEFAULT 0,
  in_progress INT NOT NULL DEFAULT 0,
  available INT NOT NULL DEFAULT 0,
  safety_stock INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_type_code, color_code, size)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_inventory TO authenticated;
GRANT ALL ON public.tshirt_inventory TO service_role;
ALTER TABLE public.tshirt_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tshirt_inventory_all_auth" ON public.tshirt_inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PO sequence + generator
CREATE SEQUENCE public.tshirt_po_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_tshirt_po_number()
RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  n BIGINT;
BEGIN
  n := nextval('public.tshirt_po_seq');
  RETURN 'PO-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
END;
$$;

-- Purchase orders
CREATE TABLE public.tshirt_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL UNIQUE DEFAULT public.generate_tshirt_po_number(),
  ordered_at DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_at DATE,
  received_at DATE,
  product_type_code TEXT NOT NULL REFERENCES public.tshirt_product_types(code),
  color_code TEXT NOT NULL REFERENCES public.tshirt_colors(code),
  status public.tshirt_po_status NOT NULL DEFAULT 'ordered',
  notes TEXT,
  created_by UUID,
  created_by_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_purchase_orders TO authenticated;
GRANT ALL ON public.tshirt_purchase_orders TO service_role;
ALTER TABLE public.tshirt_purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tshirt_po_all_auth" ON public.tshirt_purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PO items
CREATE TABLE public.tshirt_purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.tshirt_purchase_orders(id) ON DELETE CASCADE,
  size public.tshirt_size NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(po_id, size)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_purchase_order_items TO authenticated;
GRANT ALL ON public.tshirt_purchase_order_items TO service_role;
ALTER TABLE public.tshirt_purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tshirt_po_items_all_auth" ON public.tshirt_purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PO attachments
CREATE TABLE public.tshirt_purchase_order_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.tshirt_purchase_orders(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_purchase_order_attachments TO authenticated;
GRANT ALL ON public.tshirt_purchase_order_attachments TO service_role;
ALTER TABLE public.tshirt_purchase_order_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tshirt_po_att_all_auth" ON public.tshirt_purchase_order_attachments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- updated_at triggers
CREATE TRIGGER trg_tshirt_pt_upd BEFORE UPDATE ON public.tshirt_product_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tshirt_co_upd BEFORE UPDATE ON public.tshirt_colors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tshirt_inv_upd BEFORE UPDATE ON public.tshirt_inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tshirt_po_upd BEFORE UPDATE ON public.tshirt_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Receive trigger: when status flips to 'received', add item quantities to inventory in_stock + available
CREATE OR REPLACE FUNCTION public.apply_tshirt_po_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.status = 'received' AND (OLD.status IS DISTINCT FROM 'received') THEN
    IF NEW.received_at IS NULL THEN
      NEW.received_at := CURRENT_DATE;
    END IF;
    FOR r IN SELECT size, quantity FROM public.tshirt_purchase_order_items WHERE po_id = NEW.id LOOP
      INSERT INTO public.tshirt_inventory (product_type_code, color_code, size, in_stock, available, safety_stock)
      VALUES (NEW.product_type_code, NEW.color_code, r.size, r.quantity, r.quantity, 0)
      ON CONFLICT (product_type_code, color_code, size)
      DO UPDATE SET in_stock = public.tshirt_inventory.in_stock + EXCLUDED.in_stock,
                    available = public.tshirt_inventory.available + EXCLUDED.in_stock,
                    updated_at = now();
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tshirt_po_receive BEFORE UPDATE ON public.tshirt_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.apply_tshirt_po_receipt();

-- Seed product type
INSERT INTO public.tshirt_product_types(code, name_ko, name_zh, sort_order) VALUES
  ('SHORT_SLEEVE','반팔 티셔츠','短袖T恤',1);

-- Seed colors
INSERT INTO public.tshirt_colors(code, name_ko, name_zh, hex, sort_order) VALUES
  ('WHITE','화이트','白色','#ffffff',1),
  ('BLACK','블랙','黑色','#111111',2),
  ('PINK','핑크','粉色','#f9a8d4',3),
  ('BLUE','블루','蓝色','#3b82f6',4);

-- Seed inventory 28 SKUs
INSERT INTO public.tshirt_inventory (product_type_code, color_code, size, in_stock, available, safety_stock)
SELECT 'SHORT_SLEEVE', c.code, s.size,
  (10 + (random()*50)::int),
  (10 + (random()*50)::int),
  CASE WHEN s.size IN ('S','M','L','XL') THEN 20 ELSE 10 END
FROM (VALUES ('WHITE'),('BLACK'),('PINK'),('BLUE')) AS c(code)
CROSS JOIN (VALUES ('S'::public.tshirt_size),('M'),('L'),('XL'),('2XL'),('3XL'),('4XL')) AS s(size);

-- Seed POs
DO $$
DECLARE
  po1 UUID; po2 UUID; po3 UUID;
BEGIN
  INSERT INTO public.tshirt_purchase_orders(ordered_at, expected_at, product_type_code, color_code, status, notes)
  VALUES (CURRENT_DATE - 10, CURRENT_DATE - 3, 'SHORT_SLEEVE','WHITE','received','샘플 발주 1')
  RETURNING id INTO po1;
  INSERT INTO public.tshirt_purchase_order_items(po_id, size, quantity) VALUES
    (po1,'M',50),(po1,'L',50),(po1,'XL',30);

  INSERT INTO public.tshirt_purchase_orders(ordered_at, expected_at, product_type_code, color_code, status, notes)
  VALUES (CURRENT_DATE - 5, CURRENT_DATE + 2, 'SHORT_SLEEVE','BLACK','in_production','블랙 보충 발주')
  RETURNING id INTO po2;
  INSERT INTO public.tshirt_purchase_order_items(po_id, size, quantity) VALUES
    (po2,'S',40),(po2,'M',40),(po2,'L',40);

  INSERT INTO public.tshirt_purchase_orders(ordered_at, expected_at, product_type_code, color_code, status, notes)
  VALUES (CURRENT_DATE - 1, CURRENT_DATE + 7, 'SHORT_SLEEVE','PINK','ordered','신규 발주')
  RETURNING id INTO po3;
  INSERT INTO public.tshirt_purchase_order_items(po_id, size, quantity) VALUES
    (po3,'M',20),(po3,'L',20);
END $$;
