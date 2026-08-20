CREATE OR REPLACE FUNCTION public.update_shipment_carrier(
  shipment_id uuid,
  carrier_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.shipments
  SET carrier = carrier_code,
      updated_at = now()
  WHERE id = shipment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_shipment_carrier(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shipment_carrier(uuid, text) TO service_role;