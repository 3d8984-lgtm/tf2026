CREATE TABLE public.courier_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  api_url text NOT NULL DEFAULT '',
  api_mode text NOT NULL DEFAULT 'test',
  enabled boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  has_credentials boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_configs TO authenticated;
GRANT ALL ON public.courier_configs TO service_role;
ALTER TABLE public.courier_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approved users can view couriers" ON public.courier_configs
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "admins can insert couriers" ON public.courier_configs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admins can update couriers" ON public.courier_configs
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admins can delete couriers" ON public.courier_configs
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TRIGGER courier_configs_updated_at BEFORE UPDATE ON public.courier_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Secret credentials: never readable by client roles, only via edge functions (service role)
CREATE TABLE public.courier_credentials (
  code text PRIMARY KEY REFERENCES public.courier_configs(code) ON DELETE CASCADE,
  api_key text,
  api_secret text,
  account_no text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.courier_credentials TO service_role;
ALTER TABLE public.courier_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.courier_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER courier_credentials_updated_at BEFORE UPDATE ON public.courier_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.courier_configs (code, name, api_url, sort_order, is_default)
VALUES
  ('4px', '4PX', 'https://open.4px.com/router/api/service', 1, true),
  ('yunexpress', 'YunExpress', 'https://api.yunexpress.com', 2, false)
ON CONFLICT (code) DO NOTHING;