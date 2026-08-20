CREATE TABLE public.shipment_carrier_prefs (
  shipment_id uuid PRIMARY KEY REFERENCES public.shipments(id) ON DELETE CASCADE,
  carrier text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_carrier_prefs TO authenticated;
GRANT ALL ON public.shipment_carrier_prefs TO service_role;

ALTER TABLE public.shipment_carrier_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can view shipment_carrier_prefs"
  ON public.shipment_carrier_prefs
  FOR SELECT
  TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "Approved users can manage shipment_carrier_prefs"
  ON public.shipment_carrier_prefs
  FOR ALL
  TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()))
  WITH CHECK (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.update_shipment_carrier_prefs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shipment_carrier_prefs_updated_at
  BEFORE UPDATE ON public.shipment_carrier_prefs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_shipment_carrier_prefs_updated_at();