CREATE TABLE public.tshirt_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  item_no text,
  status text NOT NULL DEFAULT 'pending',
  scanned_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  fail_reason text,
  completed_at timestamptz,
  worked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_work_items TO authenticated;
GRANT ALL ON public.tshirt_work_items TO service_role;

ALTER TABLE public.tshirt_work_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can view tshirt work items"
ON public.tshirt_work_items FOR SELECT TO authenticated
USING (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can insert tshirt work items"
ON public.tshirt_work_items FOR INSERT TO authenticated
WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can update tshirt work items"
ON public.tshirt_work_items FOR UPDATE TO authenticated
USING (public.is_approved(auth.uid()))
WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Admins can delete tshirt work items"
ON public.tshirt_work_items FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_tshirt_work_items_updated_at
BEFORE UPDATE ON public.tshirt_work_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();