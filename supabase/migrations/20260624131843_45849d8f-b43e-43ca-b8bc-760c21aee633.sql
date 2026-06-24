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
  v_color text;
  v_size text;
  v_order_no text;
  v_date_key text;
  v_day_seq int;
  v_product text;
  v_design text;
BEGIN
  IF NEW.source_data IS NULL OR NEW.source_data->'items' IS NULL THEN
    RETURN NEW;
  END IF;

  v_product := COALESCE(NEW.product_code, '');
  v_design := COALESCE(NEW.design_code, NEW.product_code, '');

  -- Match the 티셔츠 부착 작업 displayed order number: local date + daily sequence.
  v_date_key := to_char(NEW.created_at AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD');

  SELECT COUNT(*)::int
    INTO v_day_seq
  FROM public.orders o
  WHERE to_char(o.created_at AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD') = v_date_key
    AND (
      o.created_at < NEW.created_at
      OR (o.created_at = NEW.created_at AND o.id::text <= NEW.id::text)
    );

  v_order_no := v_date_key || '-' || GREATEST(v_day_seq, 1)::text;

  FOR it IN SELECT * FROM jsonb_array_elements(NEW.source_data->'items') LOOP
    idx := idx + 1;
    v_qr := v_order_no || '-' || idx::text;
    v_color := COALESCE(NULLIF(it->>'tshirt_color',''), '');
    v_size  := COALESCE(NULLIF(it->>'tshirt_size',''),  '');

    INSERT INTO public.qr_silicon_master (qr_value, serial_number, product_code)
    VALUES (v_qr, v_design, v_product)
    ON CONFLICT (qr_value) DO UPDATE
      SET serial_number = EXCLUDED.serial_number,
          product_code  = EXCLUDED.product_code,
          updated_at    = now();

    INSERT INTO public.qr_tshirt_master (qr_value, color, size, product_code)
    VALUES (v_qr, v_color, v_size, v_product)
    ON CONFLICT (qr_value) DO UPDATE
      SET color = EXCLUDED.color,
          size  = EXCLUDED.size,
          product_code = EXCLUDED.product_code,
          updated_at   = now();

    -- design_code = design, design_name = product (used by validation map)
    INSERT INTO public.qr_design_master (qr_value, design_code, design_name)
    VALUES (v_qr, v_design, v_product)
    ON CONFLICT (qr_value) DO UPDATE
      SET design_code = EXCLUDED.design_code,
          design_name = EXCLUDED.design_name,
          updated_at  = now();

    -- serial_number = product, hologram_type = design (used by validation map)
    INSERT INTO public.qr_hologram_master (qr_value, serial_number, hologram_type)
    VALUES (v_qr, v_product, v_design)
    ON CONFLICT (qr_value) DO UPDATE
      SET serial_number = EXCLUDED.serial_number,
          hologram_type = EXCLUDED.hologram_type,
          updated_at    = now();
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_order_qr_to_master ON public.orders;
CREATE TRIGGER trg_sync_order_qr_to_master
AFTER INSERT OR UPDATE OF source_data, product_code, design_code, external_order_id, created_at
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_qr_to_master();

UPDATE public.orders
SET source_data = source_data
WHERE source_data IS NOT NULL;