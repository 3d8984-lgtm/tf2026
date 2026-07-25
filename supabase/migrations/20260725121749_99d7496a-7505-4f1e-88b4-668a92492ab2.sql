CREATE TABLE public.plc_active_orders (
  plc_id text PRIMARY KEY,
  plc_label text,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plc_active_orders TO authenticated;
GRANT ALL ON public.plc_active_orders TO service_role;

ALTER TABLE public.plc_active_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read plc_active_orders" ON public.plc_active_orders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert plc_active_orders" ON public.plc_active_orders
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update plc_active_orders" ON public.plc_active_orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete plc_active_orders" ON public.plc_active_orders
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_plc_active_orders_updated_at
  BEFORE UPDATE ON public.plc_active_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();