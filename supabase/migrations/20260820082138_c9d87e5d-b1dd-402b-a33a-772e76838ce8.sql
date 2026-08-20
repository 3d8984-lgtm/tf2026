update public.shipping_groups
set label_status = 'ready',
    label_error = case when label_url is null then '운송장 발급 완료 · 라벨 PDF 미수신 (재시도 시 라벨만 다시 요청)' else null end
where tracking_number is not null and label_status = 'failed';