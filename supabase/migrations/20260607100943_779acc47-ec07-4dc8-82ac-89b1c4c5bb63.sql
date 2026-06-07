-- Add 'shipped' status to PO enum
ALTER TYPE public.tshirt_po_status ADD VALUE IF NOT EXISTS 'shipped' BEFORE 'received';

-- Work logs table to track per-SKU work activity
CREATE TABLE IF NOT EXISTS public.tshirt_work_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type_code TEXT NOT NULL,
  color_code TEXT NOT NULL,
  size public.tshirt_size NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'work', -- 'work' | 'adjust'
  note TEXT,
  worked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tshirt_work_logs TO authenticated;
GRANT ALL ON public.tshirt_work_logs TO service_role;

ALTER TABLE public.tshirt_work_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage tshirt work logs"
  ON public.tshirt_work_logs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tshirt_work_logs_sku
  ON public.tshirt_work_logs(product_type_code, color_code, size, worked_at DESC);
