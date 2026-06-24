
-- Auto-register QR values from imported orders into master data tables
CREATE OR REPLACE FUNCTION public.sync_order_qr_to_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it jsonb;
  v_silicon text; v_tshirt text; v_design text; v_holo text;
  v_color text; v_size text; v_serial text;
BEGIN
  IF NEW.source_data IS NULL OR NEW.source_data->'items' IS NULL THEN
    RETURN NEW;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(NEW.source_data->'items') LOOP
    v_silicon := NULLIF(it->>'silicon_qr','');
    v_tshirt  := NULLIF(it->>'tshirt_serial','');
    v_design  := NULLIF(it->>'design_qr','');
    v_holo    := NULLIF(it->>'hologram_qr','');
    v_color   := COALESCE(NULLIF(it->>'tshirt_color',''), '');
    v_size    := COALESCE(NULLIF(it->>'tshirt_size',''),  '');
    v_serial  := COALESCE(NULLIF(it->>'tshirt_serial',''), '');

    IF v_silicon IS NOT NULL THEN
      INSERT INTO public.qr_silicon_master (qr_value, serial_number, product_code)
      VALUES (v_silicon, v_silicon, NEW.product_code)
      ON CONFLICT (qr_value) DO UPDATE SET product_code = EXCLUDED.product_code, updated_at = now();
    END IF;

    IF v_tshirt IS NOT NULL THEN
      INSERT INTO public.qr_tshirt_master (qr_value, color, size, product_code)
      VALUES (v_tshirt, v_color, v_size, NEW.product_code)
      ON CONFLICT (qr_value) DO UPDATE SET color = EXCLUDED.color, size = EXCLUDED.size, product_code = EXCLUDED.product_code, updated_at = now();
    END IF;

    IF v_design IS NOT NULL THEN
      INSERT INTO public.qr_design_master (qr_value, design_code, design_name)
      VALUES (v_design, COALESCE(NEW.design_code, ''), NULL)
      ON CONFLICT (qr_value) DO UPDATE SET design_code = EXCLUDED.design_code, updated_at = now();
    END IF;

    IF v_holo IS NOT NULL THEN
      INSERT INTO public.qr_hologram_master (qr_value, serial_number, hologram_type)
      VALUES (v_holo, v_holo, NULL)
      ON CONFLICT (qr_value) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_qr_to_master ON public.orders;
CREATE TRIGGER trg_sync_order_qr_to_master
AFTER INSERT OR UPDATE OF source_data, product_code, design_code ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_order_qr_to_master();

-- Backfill existing orders
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.orders WHERE source_data IS NOT NULL LOOP
    UPDATE public.orders SET source_data = source_data WHERE id = r.id;
  END LOOP;
END $$;
