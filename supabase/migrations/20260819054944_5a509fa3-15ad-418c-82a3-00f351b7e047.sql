CREATE TABLE public.tshirt_quality_inspections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  item_no text,
  qr_value text,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text NOT NULL DEFAULT 'pending',
  note text,
  video_path text,
  inspected_by uuid,
  inspected_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_quality_inspections TO authenticated;
GRANT ALL ON public.tshirt_quality_inspections TO service_role;

ALTER TABLE public.tshirt_quality_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can view tshirt quality inspections" ON public.tshirt_quality_inspections FOR SELECT TO authenticated USING (app_private.is_approved(auth.uid()));
CREATE POLICY "Approved users can insert tshirt quality inspections" ON public.tshirt_quality_inspections FOR INSERT TO authenticated WITH CHECK (app_private.is_approved(auth.uid()));
CREATE POLICY "Approved users can update tshirt quality inspections" ON public.tshirt_quality_inspections FOR UPDATE TO authenticated USING (app_private.is_approved(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()));
CREATE POLICY "Admins can delete tshirt quality inspections" ON public.tshirt_quality_inspections FOR DELETE TO authenticated USING (app_private.is_admin(auth.uid()));

CREATE TRIGGER trg_tshirt_quality_inspections_updated_at BEFORE UPDATE ON public.tshirt_quality_inspections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();