ALTER TABLE public.outsource_orders 
  ADD COLUMN IF NOT EXISTS wechat_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS us_due_at date,
  ADD COLUMN IF NOT EXISTS image_url text;