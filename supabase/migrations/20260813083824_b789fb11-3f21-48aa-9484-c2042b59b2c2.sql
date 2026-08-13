CREATE TABLE public.barcode_print_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('card','tshirt')),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  cutoff_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, order_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.barcode_print_resets TO authenticated;
GRANT ALL ON public.barcode_print_resets TO service_role;

ALTER TABLE public.barcode_print_resets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approved users can read barcode print resets"
ON public.barcode_print_resets FOR SELECT TO authenticated
USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert barcode print resets"
ON public.barcode_print_resets FOR INSERT TO authenticated
WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "approved users can update barcode print resets"
ON public.barcode_print_resets FOR UPDATE TO authenticated
USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can delete barcode print resets"
ON public.barcode_print_resets FOR DELETE TO authenticated
USING (public.is_approved(auth.uid()));

CREATE TRIGGER trg_barcode_print_resets_updated_at
BEFORE UPDATE ON public.barcode_print_resets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();