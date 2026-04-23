
-- Function to auto-create production_tracking and shipments when an order is inserted
CREATE OR REPLACE FUNCTION public.auto_create_order_related()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  stage_val production_stage;
  stages production_stage[] := ARRAY['tshirt','card','set','weight','courier','invoice','done']::production_stage[];
BEGIN
  -- Create production_tracking records for each stage
  FOREACH stage_val IN ARRAY stages LOOP
    INSERT INTO public.production_tracking (order_id, stage, completed_count)
    VALUES (NEW.id, stage_val, 0)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Create a shipment record
  INSERT INTO public.shipments (order_id, carrier, status, inspect_result)
  VALUES (NEW.id, '4px', 'pending', 'pending')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Create the trigger on orders table
CREATE TRIGGER trg_auto_create_order_related
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_order_related();
