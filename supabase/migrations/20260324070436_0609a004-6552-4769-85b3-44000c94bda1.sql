
-- 1. Create callback_settings table to persist A site callback configuration
CREATE TABLE public.callback_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  callback_url text NOT NULL DEFAULT '',
  auth_header text NOT NULL DEFAULT 'x-api-key',
  auth_value text NOT NULL DEFAULT '',
  auto_sync boolean NOT NULL DEFAULT false,
  sync_tracking_number boolean NOT NULL DEFAULT true,
  sync_status_change boolean NOT NULL DEFAULT true,
  sync_delivered boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.callback_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view callback_settings"
  ON public.callback_settings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert callback_settings"
  ON public.callback_settings FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update callback_settings"
  ON public.callback_settings FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_callback_settings_updated_at
  BEFORE UPDATE ON public.callback_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default row
INSERT INTO public.callback_settings (id) VALUES (gen_random_uuid());

-- 2. Enable pg_net extension for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 3. Create function that fires when tracking_number is updated
CREATE OR REPLACE FUNCTION public.notify_tracking_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _settings record;
  _order record;
  _payload jsonb;
  _edge_url text;
BEGIN
  -- Only fire when tracking_number changes from NULL to a value
  IF (OLD.tracking_number IS NOT DISTINCT FROM NEW.tracking_number) THEN
    RETURN NEW;
  END IF;

  -- Check if callback is enabled
  SELECT * INTO _settings FROM public.callback_settings LIMIT 1;
  IF _settings IS NULL OR NOT _settings.enabled OR NOT _settings.sync_tracking_number THEN
    RETURN NEW;
  END IF;

  -- Get order info
  SELECT external_order_id, recipient_name, product_code, quantity
  INTO _order FROM public.orders WHERE id = NEW.order_id;

  -- Build payload
  _payload := jsonb_build_object(
    'event', 'tracking_update',
    'shipment_id', NEW.id,
    'order_id', NEW.order_id,
    'external_order_id', _order.external_order_id,
    'tracking_number', NEW.tracking_number,
    'carrier', NEW.carrier,
    'status', NEW.status,
    'callback_url', _settings.callback_url,
    'auth_header', _settings.auth_header,
    'auth_value', _settings.auth_value
  );

  -- Call edge function via pg_net
  _edge_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/site-a-callback';

  PERFORM extensions.http_post(
    url := _edge_url,
    body := _payload::text,
    content_type := 'application/json'
  );

  RETURN NEW;
END;
$$;

-- 4. Create trigger on shipments
CREATE TRIGGER on_tracking_number_update
  AFTER UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_tracking_update();
