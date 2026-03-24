
-- Service role 정책을 제거하고, 인증된 사용자에게 필요한 권한만 부여
-- (Edge Function은 service_role key로 RLS를 우회하므로 별도 정책 불필요)

DROP POLICY "Service role can manage orders" ON public.orders;
DROP POLICY "Service role can manage tracking" ON public.production_tracking;
DROP POLICY "Service role can manage shipments" ON public.shipments;
DROP POLICY "Service role can manage logs" ON public.webhook_logs;

-- 인증된 사용자는 읽기만 가능 (쓰기는 Edge Function의 service_role로 처리)
-- SELECT 정책은 이미 존재하므로 추가 불필요
