
-- card_template
CREATE TABLE public.card_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  width_mm numeric NOT NULL DEFAULT 57,
  height_mm numeric NOT NULL DEFAULT 87,
  front_pdf_url text,
  front_preview_png_url text,
  back_pdf_url text,
  back_preview_png_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_template TO authenticated;
GRANT ALL ON public.card_template TO service_role;
ALTER TABLE public.card_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved view card_template" ON public.card_template FOR SELECT TO authenticated USING (is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "Admins insert card_template" ON public.card_template FOR INSERT TO authenticated WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins update card_template" ON public.card_template FOR UPDATE TO authenticated USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins delete card_template" ON public.card_template FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- card_element
CREATE TABLE public.card_element (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.card_template(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('front','back')),
  field_name text NOT NULL,
  element_type text NOT NULL CHECK (element_type IN ('image','text','qr','barcode')),
  x_mm numeric NOT NULL DEFAULT 0,
  y_mm numeric NOT NULL DEFAULT 0,
  width_mm numeric NOT NULL DEFAULT 10,
  height_mm numeric NOT NULL DEFAULT 10,
  font_size_pt numeric,
  font_family text,
  font_color text,
  text_align text CHECK (text_align IN ('left','center','right') OR text_align IS NULL),
  rotation_deg numeric NOT NULL DEFAULT 0,
  z_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_card_element_template ON public.card_element(template_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_element TO authenticated;
GRANT ALL ON public.card_element TO service_role;
ALTER TABLE public.card_element ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved view card_element" ON public.card_element FOR SELECT TO authenticated USING (is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "Admins insert card_element" ON public.card_element FOR INSERT TO authenticated WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins update card_element" ON public.card_element FOR UPDATE TO authenticated USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins delete card_element" ON public.card_element FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- card_order
CREATE TABLE public.card_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.card_template(id) ON DELETE RESTRICT,
  order_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_card_order_template ON public.card_order(template_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_order TO authenticated;
GRANT ALL ON public.card_order TO service_role;
ALTER TABLE public.card_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved view card_order" ON public.card_order FOR SELECT TO authenticated USING (is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "Admins insert card_order" ON public.card_order FOR INSERT TO authenticated WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins update card_order" ON public.card_order FOR UPDATE TO authenticated USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins delete card_order" ON public.card_order FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- card_order_item
CREATE TABLE public.card_order_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.card_order(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_card_order_item_order ON public.card_order_item(order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_order_item TO authenticated;
GRANT ALL ON public.card_order_item TO service_role;
ALTER TABLE public.card_order_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved view card_order_item" ON public.card_order_item FOR SELECT TO authenticated USING (is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));
CREATE POLICY "Admins insert card_order_item" ON public.card_order_item FOR INSERT TO authenticated WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins update card_order_item" ON public.card_order_item FOR UPDATE TO authenticated USING (app_private.is_admin(auth.uid())) WITH CHECK (app_private.is_admin(auth.uid()));
CREATE POLICY "Admins delete card_order_item" ON public.card_order_item FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

-- updated_at triggers
CREATE TRIGGER trg_card_template_updated BEFORE UPDATE ON public.card_template FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_card_element_updated BEFORE UPDATE ON public.card_element FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_card_order_updated BEFORE UPDATE ON public.card_order FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_card_order_item_updated BEFORE UPDATE ON public.card_order_item FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
