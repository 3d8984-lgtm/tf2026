
CREATE TYPE public.outsource_factory AS ENUM ('silicon','heat','hologram','nfc','logo');
CREATE TYPE public.outsource_status AS ENUM ('ordered','shipped','received');

CREATE TABLE public.outsource_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory public.outsource_factory NOT NULL,
  order_no text NOT NULL,
  product_code text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  ordered_at date NOT NULL DEFAULT CURRENT_DATE,
  started_at date,
  expected_at date,
  produced_at date,
  shipped_at date,
  carrier text,
  tracking_no text,
  received_at date,
  status public.outsource_status NOT NULL DEFAULT 'ordered',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outsource_orders_factory ON public.outsource_orders(factory);
CREATE INDEX idx_outsource_orders_order_no ON public.outsource_orders(order_no);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outsource_orders TO authenticated;
GRANT ALL ON public.outsource_orders TO service_role;

ALTER TABLE public.outsource_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved view outsource_orders" ON public.outsource_orders
  FOR SELECT TO authenticated
  USING (app_private.is_approved(auth.uid()) OR app_private.is_admin(auth.uid()));

CREATE POLICY "Admins insert outsource_orders" ON public.outsource_orders
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_admin(auth.uid()));

CREATE POLICY "Admins update outsource_orders" ON public.outsource_orders
  FOR UPDATE TO authenticated
  USING (app_private.is_admin(auth.uid()))
  WITH CHECK (app_private.is_admin(auth.uid()));

CREATE POLICY "Admins delete outsource_orders" ON public.outsource_orders
  FOR DELETE TO authenticated
  USING (app_private.is_admin(auth.uid()));

CREATE TRIGGER trg_outsource_orders_updated_at
BEFORE UPDATE ON public.outsource_orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
