## 목표

현재 브라우저에서 모두 처리하는 발주 흐름(PNG 생성 → ZIP → 업로드 → 위챗)을 비동기 잡 패턴으로 바꿉니다. 사용자 PC 의존을 최소화하고 1000건 규모까지 안정적으로 동작하게 만듭니다.

## 핵심 결정

PNG 렌더링 자체(Lanczos3 + Canvas mask clipping)는 **브라우저에 그대로 남깁니다**. 이유: 같은 코드를 Deno Edge Function 환경에서 동작하는 Canvas/Skia 포팅에 큰 리스크가 있고, 1000건 처리 시간보다 메모리 폭주와 단일 호출 타임아웃이 더 큰 병목입니다.

대신 다음을 서버로 옮깁니다.
- **ZIP 생성 (서버 스트리밍)**: 메모리에 모아두지 않음
- **위챗 전송**: 서버에서 ZIP 완성 직후
- **잡 상태 관리**: 진행률·실패 사유를 DB로 추적 → 탭을 닫아도 안전

## 새 흐름

```text
[브라우저]                                  [Supabase]
  PNG 1장 생성 ──► Storage 직접 PUT (signed) ──► outsource_order_jobs.uploaded++
       (10~20개 병렬, 진행률 실시간)
       ...
  모든 PNG 업로드 완료 ──► invoke('heat-order-finalize')
                                              │
                                              ▼
                          EdgeRuntime.waitUntil(
                            ① Storage에서 PNG 스트리밍 다운로드
                            ② JSZip(스트리밍) 로 ZIP 생성
                            ③ ZIP을 hologram-pdf 업로드
                            ④ 위챗 webhook 호출
                            ⑤ outsource_orders insert
                            ⑥ job.status = 'done' + zip_url
                          )
                                              │
  job 상태 폴링(2초) ◄──────────────────────┘
  완료 시 토스트 + 발주 진행 칸 done 처리
```

## 작업 항목

### 1. DB 마이그레이션
- `outsource_order_jobs` 테이블 신설 (id, order_no, factory, total_pngs, uploaded_pngs, status, stage, zip_url, error_message, webhook_url, created_at/updated_at)
- RLS: admin insert/update/delete, approved select
- GRANT 명시 (authenticated/service_role)
- `hologram-pdf` 버킷에 `orders/heat-transfer-jobs/<jobId>/` 경로 사용 (이미 public, 별도 정책 불필요)

### 2. 클라이언트 (`HeatTransferFactory.tsx`)
- `sendOrder` 재작성:
  1. `outsource_order_jobs` 잡 row 생성 → `jobId` 획득
  2. 작업지시서 PDF 1장 → `…/<jobId>/__work_order.pdf` 업로드
  3. `buildFinalPngs`를 한 장씩 콜백 받으며 만들 때마다 **즉시** Storage에 업로드(JS 동시 6개)
     - 메모리에서 즉시 blob 해제
  4. 업로드마다 잡 `uploaded_pngs++` (10개마다 한 번 batched RPC)
  5. 전부 끝나면 edge function `heat-order-finalize` 호출
  6. 잡 상태를 2초 간격으로 폴링하며 `sendStage` 표시
  7. `done`/`failed` 토스트 + UI 마무리
- 탭이 닫혀도 잡은 서버에서 계속 진행 → 재진입 시 잡 진행 중이면 그대로 폴링 재개
- "ZIP 압축/업로드"는 클라이언트에서 완전히 제거

### 3. Edge Function `heat-order-finalize` (신규)
- 입력: `{ jobId }`, JWT 검증
- 잡 row 잠금 (status: 'finalizing')
- `EdgeRuntime.waitUntil`로 백그라운드 처리:
  - Storage에서 jobId 폴더의 모든 객체 list
  - `npm:fflate` 의 스트리밍 ZIP API로 PNG/PDF를 순차 append (메모리 상주 X)
  - 완성된 ZIP을 `orders/heat-transfer-<orderNo>-<ts>.zip`에 업로드 (resumable)
  - 위챗 webhook POST (기존 `wechat-send` 로직 인라인 또는 internal invoke)
  - `outsource_orders` insert
  - 임시 PNG 폴더 정리
  - 잡 status='done', zip_url 기록 / 실패 시 'failed' + error_message
- 즉시 `{ status: 'queued', jobId }` 202 응답

### 4. Edge Function `wechat-send`
- 기존 그대로 두되, 내부에서도 재사용 가능하도록 export. 호환 유지.

## 기술 세부

- **PNG 업로드 동시성 6**: 일반 가정용 인터넷에서 안정적. 진행률 표시는 uploaded/total.
- **fflate 스트리밍 ZIP**: Deno 런타임 메모리 200MB 한계 안에서 GB급 ZIP 가능. Edge Function CPU 시간이 모자라면 finalize를 청크 단위로 재호출하는 패턴으로 확장 가능(추후).
- **재시도/멱등성**: 같은 PNG가 두 번 올라가도 `upsert: true`로 덮어쓰기. 잡 finalize는 멱등 — 동일 jobId 재호출 시 기존 ZIP 있으면 위챗만 재전송.
- **임시 파일 정리**: finalize 성공 후 Storage `…/<jobId>/` 폴더 일괄 삭제.
- **권한**: 잡 테이블은 admin만 수정, edge function은 service_role 사용.

## 기대 효과

- 100장: 사용자 체감 시간 거의 동일하지만 ZIP/업로드 단계가 사라져 더 빨라짐
- 1000장: 가능. PNG 업로드만 끝나면 탭을 닫아도 서버가 ZIP+위챗을 완료
- 실패 시 어디서 막혔는지(스테이지/메시지) DB에 남아 디버깅 용이

## 범위에서 제외(이번 작업 X)

- PNG 생성 자체의 서버 포팅(추후 옵션 — 더 큰 작업)
- 다른 공장(실리콘/홀로그램/NFC/로고) 발주 흐름 — 이번에는 열전사 디자인 공장만 변경
- 사용자 인증/권한 체계 변경
