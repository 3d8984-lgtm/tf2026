## 목표

브라우저에서 PNG 가공/ZIP/위챗 전송을 모두 제거하고, Lovable은 **Job 대시보드 + 발주 트리거**만 담당합니다. 실제 무거운 작업(Sharp 가공, ZIP 묶기, 위챗 전송)은 외부 **Railway Worker**가 수행합니다. Supabase는 Edge Function `/v1/orders`로 큐잉하고, Realtime으로 진행률을 UI에 푸시합니다.

## 새 아키텍처

```text
[Lovable UI]                  [Supabase]                    [Railway Worker]
 발주 버튼 ───POST /v1/orders──► Edge Function
                                  ├─ API Key 인증
                                  ├─ orderId UNIQUE 검사
                                  ├─ orders + job_items INSERT
                                  ├─ status=queued
                                  └─ POST /internal/process ───────► enqueue
                                                                    │
 Job 대시보드 ◄── Realtime(orders, job_items) ──────────────────────┤
   progress/total                                                    │
   실패 목록·재시도                                                 │
   완료 시 bundle.zip 링크                                          │
                                                                    │
                                  ◄── Storage 업로드 ───── bundle.zip
                                  ◄── REST 콜백(status) ── progress/done/failed
                                                              │
                                                         WeChat send (file 또는 signed URL text)
```

핵심: **Edge Function은 Sharp/ZIP/위챗을 절대 호출하지 않음.** 워커가 Storage·DB·위챗을 모두 처리합니다.

## 작업 단위

### 1. DB 마이그레이션 (단일 마이그레이션)

**기존 `outsource_order_jobs`, `png_jobs`를 폐기하고 새 모델로 교체.**

- `orders_v2` (또는 기존 `outsource_order_jobs`를 ALTER):
  - `id uuid PK`, `order_no text UNIQUE` (idempotency)
  - `factory text`, `webhook_url text`
  - `status text` enum: queued | processing | uploading | wechat | done | failed
  - `progress_current int default 0`, `progress_total int default 0`
  - `bundle_zip_path text`, `bundle_zip_url text`, `bundle_size bigint`
  - `error_message text`, `payload jsonb`
  - `created_by uuid`, `created_at`, `updated_at`
- `job_items`:
  - `id uuid PK`, `order_id uuid` FK → orders
  - `idx int`, `source_url text` (Storage 원본 디자인 URL)
  - `filename text`, `meta jsonb` (색상/사이즈/마스크 키 등 Sharp 가공 파라미터)
  - `status text` enum: pending | processing | uploaded | failed | skipped
  - `attempts int default 0`, `error_message text`, `output_path text`
- RLS: admin write, approved read (기존 패턴 유지)
- GRANT: authenticated select/insert/update/delete, service_role ALL
- Realtime 활성화: `ALTER PUBLICATION supabase_realtime ADD TABLE orders, job_items`

### 2. Edge Function `/v1/orders` (신규)

`supabase/functions/orders-create/index.ts`

- `POST` body: `{ orderNo, factory, items: [{idx, source_url, filename, meta}], webhookUrl, callbackUrl }`
- 인증: `Authorization: Bearer <API_KEY>` (Supabase secret `ORDERS_API_KEY` 검증) **또는** 기존 JWT
- Zod 스키마 검증, 400 응답
- `orders` INSERT (UNIQUE(order_no) → 중복은 기존 row 반환)
- `job_items` 배치 INSERT
- `fetch(WORKER_URL + '/internal/process', { headers: { authorization: 'Bearer ' + WORKER_SECRET }, body: { jobId } })` — fire-and-forget (`waitUntil`)
- 202 `{ jobId, status: 'queued' }` 즉시 반환
- Sharp/ZIP/위챗 **호출 금지** (코드에 import 자체 없음)

### 3. Edge Function `worker-callback` (신규)

워커가 진행률·완료·실패를 알리는 콜백.

- `POST { jobId, status, progress_current?, progress_total?, item_updates?: [...], bundle_zip_path?, error_message? }`
- `x-worker-secret` 헤더 검증
- orders/job_items UPDATE → Realtime으로 UI에 자동 전파

### 4. Railway Worker (신규, 이 레포 안 `worker/` 디렉터리)

```
worker/
├── package.json     (express, @supabase/supabase-js, sharp, archiver, p-limit, undici, zod)
├── tsconfig.json
├── Dockerfile       (node:20-slim + sharp libvips)
├── README.md        (Railway 배포 가이드)
├── .env.example
└── src/
    ├── server.ts            POST /internal/process, /health
    ├── queue.ts             in-memory queue + concurrency (1 job at a time, items 20 concurrent)
    ├── processJob.ts        메인 파이프라인
    ├── supabase.ts          service-role client
    ├── sharpPipeline.ts     원본 fetch → resize/mask/footer → PNG buffer
    ├── zipBuilder.ts        archiver streaming → temp file
    ├── storage.ts           bundle.zip upload + signed URL
    ├── wechat.ts            ≤20MB upload_media+file, else signed URL text
    └── callback.ts          Supabase orders/job_items 업데이트 + 외부 callbackUrl
```

워커 파이프라인:

1. `POST /internal/process { jobId }` 받음 → 200 즉시 응답, 백그라운드 처리
2. `job_items` 로드 (status=pending|failed AND attempts<3)
3. `p-limit(20)`로 각 item:
   - `undici.fetch(source_url)` (60s timeout)
   - Sharp 가공 (현재 브라우저 worker `htPng.worker.ts`의 Lanczos3 + mask 합성 로직을 Node로 포팅)
   - `images/{padded_idx}_{filename}.png` 임시 dir에 저장
   - 성공 → `job_items.status=uploaded`, `progress_current++` 콜백
   - 실패 → attempts++, 재시도 / 3회 초과 시 status=failed (reason 기록)
4. `processed === total` 검사. 미만이면 **failed**로 마감, 위챗·ZIP **금지**
5. 작업지시서 PDF(payload 또는 Storage path)를 zip 루트에 추가
6. archiver로 `bundle.zip` 스트리밍 생성 (level 0)
7. Supabase Storage `orders/{orderId}/bundle.zip` 업로드
8. 7일 signed URL 생성 → `orders.bundle_zip_url` 저장
9. 위챗:
   - ≤20MB: `upload_media` + `msgtype:file` + 요약 text
   - >20MB: signed URL 1개를 text로 (URL 나열 금지)
   - 실패 시 `orders.status=failed`, `error_message` 기록
10. 모두 성공 → `status=done`

`links.txt` 코드 경로는 워커·Edge 모두에서 **완전 제거**.

### 5. Lovable UI 재작성

- `src/pages/outsource/HeatTransferFactory.tsx`에서:
  - 브라우저 PNG 생성 코드(`htPngPool`, `buildFinalPngs`), Storage 직접 업로드, `heat-order-finalize` invoke 등을 **모두 제거**
  - 발주 버튼 → `supabase.functions.invoke('orders-create', { body: { orderNo, factory:'heat', items, webhookUrl } })`
  - items는 디자인 원본 URL + 메타만 전송 (Sharp 가공은 워커가 함)
- 새 `src/pages/outsource/OrderJobsDashboard.tsx`:
  - `orders` 리스트 + Realtime 구독
  - 각 row: `progress_current/progress_total` 프로그레스바, ETA, 상태 배지
  - 펼침: `job_items` 실패 목록 (idx/filename/reason), **재시도 버튼** (item attempts 리셋 → orders status=queued → 워커 재호출)
  - 위챗 실패 시 **재전송 버튼** (worker `/internal/wechat-resend` 호출)
- 사이드바: "발주 진행 상황" 메뉴 추가
- 기존 `htPngPool.ts`, `htPng.worker.ts`, `uploadManager.ts`, `heat-order-finalize/index.ts`, `png_jobs` 관련 코드 삭제

### 6. Secrets

런타임 secrets로 추가 필요:
- `WORKER_URL` (예: `https://twinmeta-worker.up.railway.app`)
- `WORKER_SECRET` (Edge ↔ Worker 공유 토큰)
- `ORDERS_API_KEY` (외부에서 `/v1/orders` 호출 시)

워커 환경변수(Railway 대시보드):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `WORKER_SECRET`
- `WECHAT_WEBHOOK_DEFAULT` (선택)

이 3개 시크릿은 사용자가 Railway 배포 후 알려주면 `add_secret`으로 등록합니다.

## 사용자 액션 (이 작업 후 필요)

1. Railway 계정 만들고 이 레포의 `worker/` 디렉터리를 새 서비스로 배포 (Dockerfile 자동 감지)
2. Railway 환경변수 입력 (위 목록)
3. 배포된 URL과 본인이 정한 `WORKER_SECRET`을 Lovable에 알려주기 → 제가 secrets 등록
4. README에 단계별 가이드 동봉

## 범위에서 제외

- 다른 공장(실리콘/홀로그램/NFC/로고) 발주 — 이번엔 열전사만
- 기존 진행 중 job 마이그레이션 (`png_jobs` 테이블은 drop)
- 인증/권한 체계 변경
- 워커 자동 배포 (CI/CD) — 수동 배포

## 위험·완화

- **Sharp 포팅**: 브라우저 worker의 캔버스 합성 로직을 Node Sharp로 1:1 재현해야 함 → 워커 코드에 단위 테스트 포함, 첫 발주는 소량으로 검증
- **워커 다운**: Edge는 fire-and-forget이므로 워커 죽으면 job이 queued로 멈춤 → 대시보드에 "처음 시도 후 N분 무응답" 경고 + 수동 재시도 버튼
- **idempotency**: 같은 `orderNo`로 재요청 시 기존 jobId 반환 (DB UNIQUE + ON CONFLICT)

## 결과물

- 마이그레이션 1건 (orders/job_items 신설, png_jobs/outsource_order_jobs drop)
- Edge functions 2개 (orders-create, worker-callback)
- worker/ 디렉터리 신규 (Node + Sharp + Archiver, Dockerfile + README)
- HeatTransferFactory 슬림화 + 새 OrderJobsDashboard 페이지
- 기존 heat-order-finalize, htPngPool, htPng.worker, uploadManager 제거