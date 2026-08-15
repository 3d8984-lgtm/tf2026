# 택배 발송 포장 — 송장 사전발급 구조 전환

## 1. 현재 구조 분석 (요청 32번 항목)

### 주문 1건과 shipment_scan_items 관계
- `orders` 1행 = 엑셀 업로드 1행이며 `quantity`(최대 5)와 `source_data.items[]`(제품별 상세 + Q~T열 수취인)을 가짐.
- `orders` INSERT 시 트리거 `auto_create_order_related` → `shipments` 1행 생성 → 트리거 `create_shipment_scan_slots` → `quantity` 만큼 `shipment_scan_items`(position 1..N) 생성.
- 즉 **실제 "제품 1개" 단위는 order가 아니라 `shipment_scan_items` 1행**이고, 그 행의 수취인은 `orders.source_data.items[position-1]`에 있음.
- 스캔 화면(`/shipping/scan/:orderId`)은 **주문 1건 단위**로만 동작한다 → 서로 다른 주문에 걸친 동일 수취인 그룹핑은 현재 불가능.

### 동일 수취인 그룹핑 기준 데이터
- 그룹 키는 `source_data.items[i]`의 `recipient_name` + `recipient_phone` + `shipping_address` + `shipping_zip`.
- `orders.recipient_name`은 트윈커명(C열)이므로 사용 금지(이미 배송에서 배제됨).
- 정규화: trim, 전화번호 숫자만, 주소 연속공백 1칸, 대소문자 무시. fuzzy matching 없음.

### 별도 테이블 필요 여부 → 필요함
- 그룹이 여러 order/shipment에 걸치므로 기존 `shipments`(order 1:1) 로는 표현 불가.
- 신규 테이블 `shipping_groups` + `shipment_scan_items.shipping_group_id` 연결이 가장 안전(기존 데이터 무손상).

### tracking_number / label_url 현재 저장 위치
- `shipments.tracking_number / label_url / tracking_issued_at` (주문 단위, 엣지 함수가 업데이트)
- `shipment_scan_items.carrier / tracking_number / label_url / tracking_issued_at` (행 단위, 최근 추가)
- 앞으로는 **그룹이 원본(single source of truth)**, 나머지는 표시 호환용 미러링.

### 4PX 호출 위치
- `supabase/functions/courier-label/index.ts` → `call4px()` (`ds.xms.order.create` v1.1.0 → `ds.xms.label.get` v1.1.0), `callYunExpress()`.
- 수취인 변환은 `supabase/functions/_shared/addr.ts` (`normalizeRecipient`), 서명은 `_shared/fpx.ts`.
- 클라이언트 호출: `src/hooks/useCouriers.ts` → `requestCarrierLabel()`.

### QR 스캔 이후 4PX 호출 지점
- `ShippingScan.tsx` `handleScan()` → 마지막 슬롯 스캔 시 `issueTrackingViaApi()` → `requestCarrierLabel()` → 엣지 함수. **이 경로를 제거**한다.

### 초기화 기능의 현재 동작 (문제)
- `resetScanWork()`가 `shipment_scan_items`의 `tracking_number/label_url/tracking_issued_at`과 `shipments.tracking_number`까지 NULL 처리 → 사전발급 송장이 지워짐. **스캔 상태만 초기화하도록 변경**.

### 기존 출력 기능 재사용
- `buildRemoteLabelHtml()` + `window.print()` 유지. 입력만 `그룹.label_url`로 바꿈. 100×150mm, PDF 원본 그대로.

### N개 QR 완료 판정
- `shipping_groups.required_scan_count`(그룹에 속한 scan_item 수) vs 그룹에 연결된 `shipment_scan_items` 중 `is_scanned=true` 개수. 같아지는 순간에만 출력.

### 중복 송장 DB 차단
- `shipping_groups`에 정규화 키(`group_key`) UNIQUE + 발급은 `label_status='pending'` 조건부 UPDATE(compare-and-set)로 idempotent 보장.

---

## 2. 구현 계획

### DB (마이그레이션 1회)
```
shipping_groups
  id, group_key(unique), recipient_name, recipient_phone,
  shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country,
  item_count, required_scan_count, scanned_count,
  carrier, tracking_number(unique), label_url, label_status(pending|issuing|ready|failed),
  label_error, label_issued_at, printed_at, scan_status, created_at, updated_at
shipment_scan_items += shipping_group_id (FK, index)
```
GRANT + RLS(승인 사용자 read/write, service_role all) 포함.

### 엣지 함수
- `courier-label`: `shipping_group_id` 입력 지원 추가. 그룹 기준 수취인/수량(`declare_product_code_qty = item_count`, `parcel_value = 단가 × item_count`)으로 4PX 주문 생성 후 그룹에 tracking/label 저장. 기존 `shipment_id` 경로는 호환 유지.
- 신규 `shipping-groups-build`: 대상 주문들의 scan item을 정규화 키로 묶어 `shipping_groups` upsert + `shipping_group_id` 연결(멱등).

### 프론트엔드
- `src/hooks/useShippingGroups.ts`: 그룹 목록/빌드/사전발급(동시 6건 큐, 진행률 콜백)/재시도.
- `ShippingScan.tsx`
  - 상단 **[송장 사전발행]** 버튼 + 확인 모달(전체 주문 / 발송건 / 1건 / 묶음 / 이미 발급 / 새로 발급 수) + 진행률 모달(성공·실패 실시간).
  - 주소록 목록에 탭 **전체 / 1건 주문 / 2개 이상 주문**(각 건수는 그룹 수 기준), 묶음은 아코디언 그룹 행(수취인, 제품수량, 스캔 n/N, 송장상태, tracking) + 내부 주문 행.
  - `handleScan`: 4PX 호출 제거 → QR로 scan item 매칭 → 그룹 조회 → DB 기준 중복 검사 → 스캔 기록 → `scanned == required`일 때만 캐시된 label 출력. 미발급이면 "송장 미발급" 안내만.
  - 현재 작업 중 그룹 패널(수취인 / n/N / ● ○ ○ / 완료 시 초록 피드백), 그룹별 부분 스캔 상태 독립 유지.
  - 페이지 진입 시 발급완료 label prefetch → blob URL 캐시(최대 개수 제한), 스캔 시 캐시 우선 사용, `window.open` 사전 생성은 캐시 히트 시 지연 없이 즉시 write.
  - `resetScanWork()`: 스캔 상태만 초기화, tracking/label 보존. 별도 "송장 재발급" 액션 분리.
  - `performance.now()` 기반 `QR_SCANNED → GROUP_MATCHED → LABEL_READY → PRINT_CALLED` 콘솔 표 출력.
- 로그: `label_preissue_started/success/failed`, `scan_success/duplicate/group_progress/group_completed`, `label_print_requested/success/failed` (shipment_id, group_id, position, qr_value, tracking, elapsed_ms 포함).

### 보존
HID 리더, 카메라 스캐너, 중복 방지, `qr_hologram_master` 확인, 테스트 모드, 발송보고, 사운드/배너, YunExpress, 4PX 주소 변환, 100×150 출력 로직은 그대로 유지.
