CREATE OR REPLACE FUNCTION public.sync_order_qr_to_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  it jsonb;
  idx int := 0;
  v_qr text;
  v_color text; v_size text;
BEGIN
  IF NEW.source_data IS NULL OR NEW.source_data->'items' IS NULL OR NEW.external_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(NEW.source_data->'items') LOOP
    idx := idx + 1;
    v_qr := NEW.external_order_id || '-' || idx::text;
    v_color := COALESCE(NULLIF(it->>'tshirt_color',''), '');
    v_size  := COALESCE(NULLIF(it->>'tshirt_size',''),  '');

    -- silicon: serial_number stores design_code so validation found.design matches
    INSERT INTO public.qr_silicon_master (qr_value, serial_number, product_code)
    VALUES (v_qr, COALESCE(NEW.design_code, NEW.product_code, ''), NEW.product_code)
    ON CONFLICT (qr_value) DO UPDATE
      SET serial_number = EXCLUDED.serial_number,
          product_code  = EXCLUDED.product_code,
          updated_at    = now();

    -- tshirt
    INSERT INTO public.qr_tshirt_master (qr_value, color, size, product_code)
    VALUES (v_qr, v_color, v_size, NEW.product_code)
    ON CONFLICT (qr_value) DO UPDATE
      SET color = EXCLUDED.color,
          size  = EXCLUDED.size,
          product_code = EXCLUDED.product_code,
          updated_at   = now();

    -- design
    INSERT INTO public.qr_design_master (qr_value, design_code, design_name)
    VALUES (v_qr, COALESCE(NEW.design_code, NEW.product_code, ''), NULL)
    ON CONFLICT (qr_value) DO UPDATE
      SET design_code = EXCLUDED.design_code,
          updated_at  = now();

    -- hologram: serial_number stores product_code so validation matches
    INSERT INTO public.qr_hologram_master (qr_value, serial_number, hologram_type)
    VALUES (v_qr, COALESCE(NEW.product_code, ''), NULL)
    ON CONFLICT (qr_value) DO UPDATE
      SET serial_number = EXCLUDED.serial_number,
          updated_at    = now();
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_order_qr_to_master ON public.orders;
CREATE TRIGGER trg_sync_order_qr_to_master
AFTER INSERT OR UPDATE OF source_data, product_code, design_code, external_order_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_qr_to_master();

-- Backfill: refire trigger for all existing orders
UPDATE public.orders SET source_data = source_data WHERE source_data IS NOT NULL;
