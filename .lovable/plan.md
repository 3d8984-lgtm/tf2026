## 배송관리 재설계 계획

### ⚠️ 주의사항
"전면 교체"를 선택하셨지만, 현재 `shipments` 테이블은 Dashboard, ProductionMonitor, Reports, FileUpload, 그리고 7단계 생산 워크플로우(`auto_create_order_related` 트리거) 전반에서 사용됩니다. 완전 삭제 시 시스템 전반에 영향이 큽니다.

따라서 **shipments 테이블은 유지하되 배송관리 페이지만 새 QR 워크플로우로 전면 재작성**하는 방향을 권장합니다. 새 워크플로우에 필요한 컬럼만 shipments에 추가합니다.

---

### 1. DB 변경 (마이그레이션)

**`shipments` 테이블에 컬럼 추가:**
- `scan_status` enum (`pending`/`scanning`/`ready`/`shipped`/`reported`)
- `scanned_count` int (default 0)
- `design_confirmed` bool (default false)
- `tracking_issued_at` timestamptz
- `reported_at` timestamptz

**신규 테이블 `shipment_scan_items`:**
- `id`, `shipment_id` FK, `order_id` FK
- `qr_serial` text — `qr_tshirt_master.serial`을 참조 (단순 텍스트로 저장)
- `product_code`, `design_code`, `design_image_url`
- `is_scanned` bool, `scanned_at`, `scanned_by`
- `position` int (주문 내 순서)

**신규 테이블 `shipping_logs`:**
- `shipment_id`, `action_type` (`scan`/`mismatch`/`issue_tracking`/`print`/`report`)
- `worker_id`, `details` jsonb, `created_at`

주문 생성 시(`auto_create_order_related` 트리거 확장) 주문 수량만큼 `shipment_scan_items` 행을 빈 상태로 생성. QR 매칭은 스캔 시점에 `qr_tshirt_master`에서 product/design 코드로 가능한 후보를 끌어와 채움.

### 2. 페이지 구조

```
/shipping                  → 배송 대기 목록 (재작성)
/shipping/scan/:orderId    → QR 스캔 작업 화면 (신규)
/shipping/logs             → 작업 이력 (옵션, 사이드 패널로 처리)
```

**기존 `/shipping`의 그룹 아코디언 UI는 제거**하고 작업자 친화적인 큰 카드/버튼 기반 대기열로 교체.

### 3. 배송 대기 목록 (`/shipping`)

테이블 컬럼: Job No · Twinker(고객) · 상품 수(스캔진행 `n/m`) · 상태 뱃지(대기/스캔중/완료/송장발급/회신완료) · Due Date · [QR 스캔 시작] 버튼

필터: 상태별 · 검색(Job No, Twinker)
KPI: 오늘 출고/대기/완료/오류

### 4. QR 스캔 화면 (`/shipping/scan/:orderId`)

3패널 레이아웃:

```text
┌──────────────────────┬────────────────────────┐
│ ① QR 스캐너          │ ② 주문 정보            │
│  - 카메라 (html5-qrcode) │  Job No / Twinker  │
│  - USB 스캐너 input   │  주소 / 수량 진행률  │
│  (자동 포커스 유지)   │  상태 뱃지            │
├──────────────────────┴────────────────────────┤
│ ③ 디자인 검수 그리드 (수량만큼 카드)          │
│   카드: 디자인 이미지 / QR / 스캔여부 / 확인 │
├───────────────────────────────────────────────┤
│  [송장 발급] (모두 스캔 + 모두 확인시 활성화) │
└───────────────────────────────────────────────┘
```

**스캔 로직:**
1. QR 입력 → `qr_tshirt_master`에서 조회
2. 현재 주문의 product/design과 일치하는지 검증 (불일치 시 부저+경고+log)
3. 같은 주문 내 미스캔 슬롯에 채움, 중복 차단
4. 모든 슬롯 스캔 + 작업자 디자인 확인 체크 시 송장발급 버튼 활성화

**피드백:** 성공/실패 사운드 (Web Audio API), 토스트, 시각 효과

### 5. 송장 발급 (Mock)

- 모달: 택배사 선택(드롭다운) + 송장번호 입력(수기) 또는 [자동 발급(MOCK)] → 가상 번호 생성 (`MOCK-YYYYMMDD-XXXX`)
- DB 업데이트: `tracking_number`, `carrier`, `scan_status='ready'`, `tracking_issued_at`
- 라벨 미리보기 다이얼로그 + "라벨 PDF 다운로드" / "ZPL 다운로드" 버튼 (브라우저 생성, 실제 프린터 연동 없음)

### 6. 트윈메타 회신 (기존 callback_settings 재사용)

송장 발급 직후 자동 호출: 기존 `notify_tracking_update` 트리거가 이미 `tracking_number` 변경 시 `site-a-callback` 엣지 함수를 호출함. 따라서 **추가 코드 없이 동작**.
회신 성공 시 `scan_status='reported'`, `reported_at` 기록은 `site-a-callback` 함수에 후처리로 추가.

### 7. 예외 처리

| 상황 | 대응 |
|---|---|
| 이미 스캔된 QR | 토스트 + 부저 + `shipping_logs` 기록 |
| 다른 주문의 QR | 빨간 배너 + 부저 + 거부 |
| 디자인 미확인 | 송장 버튼 비활성 + 미확인 카드 강조 |
| 회신 실패 | `scan_status='ready'` 유지, 수동 [재전송] 버튼 |
| 작업 중단 | 진행 상태 DB 저장으로 자연스럽게 이어서 가능 |

### 8. 영향받는 파일

신규
- `src/pages/ShippingQueue.tsx` (기존 Shipping.tsx 대체)
- `src/pages/ShippingScan.tsx`
- `src/hooks/useShippingQueue.ts`, `useShipmentScan.ts`
- `src/lib/scan-sound.ts`, `src/lib/mock-tracking.ts`

수정
- `src/App.tsx` 라우트 교체/추가
- `src/components/AppLayout.tsx` 메뉴(필요시)
- `supabase/functions/site-a-callback/index.ts` reported 상태 기록 추가

의존성
- `html5-qrcode` 추가

### 8단계 외(다음 단계 옵션)
- 실제 택배사 API 연동 (4PX 등)
- qz-tray 로컬 ZPL 출력
- 일별 출고 통계 위젯
- 송장 취소/반품 워크플로우

---

확인 부탁드려요 — 특히 **shipments 테이블 유지(확장)** 방향이 괜찮은지, 그리고 기존 `/shipping`의 그룹 아코디언 UI를 완전히 제거해도 되는지가 가장 큰 결정입니다.
