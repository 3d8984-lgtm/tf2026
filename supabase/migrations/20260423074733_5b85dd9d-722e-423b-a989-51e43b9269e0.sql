
-- Add upload_history_id to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS upload_history_id uuid;

-- Add DELETE policies
CREATE POLICY "Authenticated users can delete orders"
ON public.orders FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete tracking"
ON public.production_tracking FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete shipments"
ON public.shipments FOR DELETE TO authenticated USING (true);

-- Make foreign keys CASCADE on delete
ALTER TABLE public.production_tracking
  DROP CONSTRAINT IF EXISTS production_tracking_order_id_fkey,
  ADD CONSTRAINT production_tracking_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_order_id_fkey,
  ADD CONSTRAINT shipments_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
