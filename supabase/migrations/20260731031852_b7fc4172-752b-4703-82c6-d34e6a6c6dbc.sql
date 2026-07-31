ALTER TABLE public.plc_active_orders
  ADD COLUMN IF NOT EXISTS package_length_mm numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS length_base_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cumulative_length_m numeric NOT NULL DEFAULT 0;