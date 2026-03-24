
-- ===========================================
-- TWINMETA FACTORY DB Schema
-- ===========================================

-- 1. 타임스탬프 자동 갱신 함수
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ===========================================
-- 2. 주문 (A 사이트에서 수신)
-- ===========================================
CREATE TYPE public.order_status AS ENUM (
  'received',
  'in_production',
  'completed',
  'shipped',
  'cancelled'
);

CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_order_id TEXT NOT NULL UNIQUE,
  product_code TEXT NOT NULL,
  design_code TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status order_status NOT NULL DEFAULT 'received',
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT,
  shipping_address TEXT NOT NULL,
  shipping_city TEXT,
  shipping_state TEXT,
  shipping_zip TEXT,
  shipping_country TEXT NOT NULL DEFAULT 'US',
  source_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===========================================
-- 3. 생산 추적 (공정별 진행 상황)
-- ===========================================
CREATE TYPE public.production_stage AS ENUM (
  'tshirt', 'card', 'set', 'weight', 'courier', 'invoice', 'done'
);

CREATE TABLE public.production_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stage production_stage NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  machine_id TEXT,
  machine_status TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, stage)
);

ALTER TABLE public.production_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view tracking" ON public.production_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage tracking" ON public.production_tracking FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_production_tracking_updated_at BEFORE UPDATE ON public.production_tracking
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===========================================
-- 4. 출고/배송 (택배사 연동)
-- ===========================================
CREATE TYPE public.shipment_status AS ENUM (
  'pending', 'label_requested', 'label_received', 'packed', 'shipped', 'in_transit', 'delivered', 'hold'
);

CREATE TYPE public.inspect_result AS ENUM (
  'pending', 'pass', 'mismatch', 'weight_fail'
);

CREATE TABLE public.shipments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  set_id TEXT,
  carrier TEXT NOT NULL DEFAULT '4px',
  tracking_number TEXT,
  label_url TEXT,
  status shipment_status NOT NULL DEFAULT 'pending',
  inspect_qr_match BOOLEAN,
  inspect_weight BOOLEAN,
  inspect_result inspect_result NOT NULL DEFAULT 'pending',
  weight_grams INTEGER,
  expected_weight_grams INTEGER,
  carrier_response JSONB,
  synced_to_source BOOLEAN DEFAULT false,
  synced_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view shipments" ON public.shipments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage shipments" ON public.shipments FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_shipments_updated_at BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===========================================
-- 5. Webhook 수신 로그
-- ===========================================
CREATE TABLE public.webhook_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'site_a',
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view logs" ON public.webhook_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage logs" ON public.webhook_logs FOR ALL USING (true) WITH CHECK (true);

-- ===========================================
-- 인덱스
-- ===========================================
CREATE INDEX idx_orders_external_id ON public.orders(external_order_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_production_order_id ON public.production_tracking(order_id);
CREATE INDEX idx_shipments_order_id ON public.shipments(order_id);
CREATE INDEX idx_shipments_tracking ON public.shipments(tracking_number);
CREATE INDEX idx_shipments_status ON public.shipments(status);
CREATE INDEX idx_webhook_logs_created ON public.webhook_logs(created_at DESC);
