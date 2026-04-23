
-- Backfill: create missing production_tracking for existing orders
INSERT INTO public.production_tracking (order_id, stage, completed_count)
SELECT o.id, s.stage, 0
FROM public.orders o
CROSS JOIN (VALUES ('tshirt'::production_stage),('card'::production_stage),('set'::production_stage),('weight'::production_stage),('courier'::production_stage),('invoice'::production_stage),('done'::production_stage)) AS s(stage)
WHERE NOT EXISTS (
  SELECT 1 FROM public.production_tracking pt WHERE pt.order_id = o.id AND pt.stage = s.stage
);

-- Backfill: create missing shipments for existing orders
INSERT INTO public.shipments (order_id, carrier, status, inspect_result)
SELECT o.id, '4px', 'pending', 'pending'
FROM public.orders o
WHERE NOT EXISTS (
  SELECT 1 FROM public.shipments sh WHERE sh.order_id = o.id
);

-- Backfill: link existing orders to their upload history
UPDATE public.orders SET upload_history_id = (
  SELECT uh.id FROM public.upload_history uh ORDER BY uh.created_at DESC LIMIT 1
)
WHERE upload_history_id IS NULL;
