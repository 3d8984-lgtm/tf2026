# TWINMETA Order Worker (Railway)

Lovable의 `/v1/orders` Edge Function이 enqueue하는 발주 작업을 받아, **이미지 가공(Sharp) → ZIP 묶기 → Supabase Storage 업로드 → WeChat Work 전송**까지 처리하는 Node 서비스입니다.

## 아키텍처

```
Lovable UI ── POST /v1/orders ──► Supabase Edge Function
                                    └─ order_jobs / order_job_items 저장
                                    └─ POST {WORKER_URL}/internal/process { jobId }
                                                                   │
                                                                   ▼
                                                       이 워커가 처리:
                                                         ① items.source_url fetch
                                                         ② Sharp 가공 → PNG
                                                         ③ archiver 스트리밍 ZIP
                                                         ④ Storage `orders/{jobId}/bundle.zip`
                                                         ⑤ WeChat (≤20MB file / >20MB signed URL)
                                                       ── POST /worker-callback (진행률·완료·실패)
```

`links.txt` 방식은 폐기되었습니다. WeChat에는 항상 단일 ZIP 파일 또는 ZIP 1개의 다운로드 링크만 전송됩니다.

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

## Railway 배포

1. https://railway.app 에 가입 후 새 프로젝트 생성
2. **Deploy from GitHub repo** 선택 → 이 레포 연결
3. **Root directory**를 `worker`로 지정
4. Dockerfile은 자동 감지됩니다 (`worker/Dockerfile`)
5. **Variables** 탭에서 다음 환경변수 입력:

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://bbsfhmarrcvhvcmuqwej.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | (Supabase Settings → API → service_role key) |
| `WORKER_SECRET` | 본인이 정한 긴 랜덤 문자열 (Lovable에도 같은 값 등록) |
| `WORKER_CALLBACK_URL` | `https://bbsfhmarrcvhvcmuqwej.supabase.co/functions/v1/worker-callback` |
| `STORAGE_BUCKET` | `hologram-pdf` |
| `IMAGE_CONCURRENCY` | `20` (선택) |

6. **Networking** → **Generate Domain**으로 공개 URL 발급 (예: `https://twinmeta-worker.up.railway.app`)

## Lovable 측 등록

배포된 URL과 `WORKER_SECRET`을 알려주시면, Lovable에 아래 시크릿을 등록합니다:

- `WORKER_URL`
- `WORKER_SECRET`
- `ORDERS_API_KEY` (선택 — 외부에서 `/v1/orders`를 부를 때 쓸 키)

## 처리 동작

- `order_job_items.attempts`는 최대 3까지 자동 재시도
- `processed < total`이면 **`failed`** 마감 → ZIP/WeChat 단계 건너뜀
- WeChat 실패 시 `order_jobs.status='failed'` + `error_message` 기록 → UI에서 "위챗 재전송" 버튼 노출
- 같은 `orderNo`로 재호출되면 기존 job이 그대로 반환됨 (UNIQUE 제약)

## Sharp 가공 파라미터

`order_job_items.meta`에 다음 필드를 보낼 수 있습니다:

```json
{
  "targetW": 2126,
  "targetH": 2598,
  "footer": { "text": "...", "fontSize": 36 },
  "mask": { "url": "https://..." },
  "transform": { "offsetXPct": 0, "offsetYPct": 0, "scale": 1 }
}
```

세부 가공 규칙은 `src/sharpPipeline.ts`를 참고하세요. 브라우저 워커(`htPng.worker.ts`)의 Lanczos3 + mask clipping 로직과 가능한 한 동일하게 동작합니다.
