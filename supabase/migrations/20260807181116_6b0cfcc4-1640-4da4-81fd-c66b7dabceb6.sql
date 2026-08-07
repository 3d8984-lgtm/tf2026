CREATE TABLE public.barcode_print_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('card','tshirt')),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  position integer NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  verdict text,
  scanned_value text,
  scanned_at timestamptz,
  printed_at timestamptz,
  test_mode boolean NOT NULL DEFAULT false,
  worked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, order_id, position)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.barcode_print_items TO authenticated;
GRANT ALL ON public.barcode_print_items TO service_role;

ALTER TABLE public.barcode_print_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approved users can read barcode print items"
ON public.barcode_print_items FOR SELECT TO authenticated
USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert barcode print items"
ON public.barcode_print_items FOR INSERT TO authenticated
WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "approved users can update barcode print items"
ON public.barcode_print_items FOR UPDATE TO authenticated
USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can delete barcode print items"
ON public.barcode_print_items FOR DELETE TO authenticated
USING (public.is_approved(auth.uid()));

CREATE TRIGGER trg_barcode_print_items_updated_at
BEFORE UPDATE ON public.barcode_print_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();