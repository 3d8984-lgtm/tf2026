ALTER TABLE public.shipment_scan_items
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS tracking_issued_at timestamptz;