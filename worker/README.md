# TWINMETA Order Worker (Render)

Lovable의 `/v1/orders` Edge Function이 enqueue하는 발주 작업을 받아, **이미지 가공(Sharp) → ZIP 묶기 → Storage 업로드 → WeChat Work 전송**까지 처리하는 Node 서비스입니다.

## 아키텍처 (service_role 키 없이 동작)

```
Lovable UI ── POST /v1/orders ──► orders-create Edge Function
                                    └─ order_jobs / order_job_items 저장
                                    └─ POST {WORKER_URL}/internal/process { jobId }
                                                                   │
                                                                   ▼
                                                       Render 워커:
                                                         ① worker-fetch-job 호출
                                                            → job + items + signed upload URL
                                                         ② items.source_url fetch (public)
                                                         ③ Sharp 가공 → PNG
                                                         ④ archiver 스트리밍 ZIP
                                                         ⑤ ZIP을 signed upload URL로 PUT
                                                         ⑥ WeChat 전송
                                                       ── worker-callback (진행률·완료·실패)
```

**중요**: 워커는 `SUPABASE_SERVICE_ROLE_KEY`를 사용하지 않습니다. 모든 DB/Storage 접근은 `WORKER_SECRET`으로 인증되는 Edge Function 3개를 거칩니다:
- `worker-fetch-job` — job/items 조회 + bundle.zip pre-signed upload URL 발급
- `worker-bundle-info` — 위챗 재전송 시 기존 bundle 다운로드 URL 발급
- `worker-callback` — 진행률·상태 업데이트 (path 받으면 signed view URL 자동 생성)

## 로컬 실행

```bash
cd worker
cp .env.example .env   # 값 채우기
npm install
npm run dev
```

엔드포인트:
- `GET /health`
- `POST /internal/process` — body `{ jobId: string }`, header `Authorization: Bearer $WORKER_SECRET`
- `POST /internal/wechat-resend` — body `{ jobId }` (실패한 위챗 전송 재시도)

## Render 배포

1. https://render.com 에 가입 후 **New + → Web Service**
2. **Connect a repository** → `3d8984-lgtm/tf2026` 선택
3. 설정:
   - **Root Directory**: `worker`
   - **Runtime**: Docker (`worker/Dockerfile` 자동 감지)
   - **Instance Type**: Starter 이상 (Sharp + ZIP 메모리 여유)
   - **Health Check Path**: `/health`
4. **Environment** 탭에서 다음 환경변수 입력 (단 4개):

| 이름 | 값 |
|---|---|
| `SUPABASE_FUNCTIONS_URL` | `https://bbsfhmarrcvhvcmuqwej.supabase.co/functions/v1` |
| `WORKER_SECRET` | 본인이 정한 긴 랜덤 문자열 (Lovable Cloud Secrets에도 동일 값 등록) |
| `WECHAT_WEBHOOK_KEY` | 위챗 웹훅 key (기본값 fallback) |
| `PORT` | `8080` (선택) |
| `IMAGE_CONCURRENCY` | `20` (선택) |

> ❌ **`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET`, `WORKER_CALLBACK_URL`은 더 이상 필요 없습니다.**

5. 배포 후 발급되는 공개 URL 예시: `https://twinmeta-worker.onrender.com`
6. 검증: `curl https://<your-service>.onrender.com/health` → `{ "ok": true }`

## Lovable 측 등록 (Cloud → Secrets)

다음 시크릿이 Lovable Cloud에 등록되어 있어야 합니다:

- `WORKER_URL` — Render 배포 URL (예: `https://twinmeta-worker.onrender.com`)
- `WORKER_SECRET` — Render와 동일 값
- `ORDERS_API_KEY` (선택)

## 처리 동작

- `order_job_items.attempts`는 최대 3까지 자동 재시도
- `processed < total`이면 **`failed`** 마감 → ZIP/WeChat 단계 건너뜀
- WeChat 실패 시 `order_jobs.status='failed'` + `error_message` 기록 → UI에서 "위챗 재전송" 버튼 노출
- 같은 `orderNo`로 재호출되면 기존 job이 그대로 반환됨 (UNIQUE 제약)
