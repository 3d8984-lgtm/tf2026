CREATE TABLE public.shipping_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL,
  recipient_name text NOT NULL DEFAULT '',
  recipient_phone text NOT NULL DEFAULT '',
  shipping_address text NOT NULL DEFAULT '',
  shipping_city text,
  shipping_state text,
  shipping_zip text NOT NULL DEFAULT '',
  shipping_country text NOT NULL DEFAULT 'US',
  item_count integer NOT NULL DEFAULT 0,
  required_scan_count integer NOT NULL DEFAULT 0,
  scanned_count integer NOT NULL DEFAULT 0,
  carrier text,
  tracking_number text,
  label_url text,
  label_status text NOT NULL DEFAULT 'pending',
  label_error text,
  label_issued_at timestamptz,
  printed_at timestamptz,
  scan_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX shipping_groups_group_key_uidx ON public.shipping_groups (group_key);
CREATE UNIQUE INDEX shipping_groups_tracking_uidx ON public.shipping_groups (tracking_number) WHERE tracking_number IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipping_groups TO authenticated;
GRANT ALL ON public.shipping_groups TO service_role;

ALTER TABLE public.shipping_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can view shipping groups"
  ON public.shipping_groups FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can create shipping groups"
  ON public.shipping_groups FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can update shipping groups"
  ON public.shipping_groups FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Admins can delete shipping groups"
  ON public.shipping_groups FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_shipping_groups_updated_at
  BEFORE UPDATE ON public.shipping_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.shipment_scan_items
  ADD COLUMN IF NOT EXISTS shipping_group_id uuid REFERENCES public.shipping_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS shipment_scan_items_group_idx ON public.shipment_scan_items (shipping_group_id);