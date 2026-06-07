## 티셔츠 공장 메뉴 추가 계획

외주 생산 대분류에 새로운 "티셔츠 공장" 메뉴를 추가하고, 재고 관리 + 발주 관리 통합 페이지를 구축합니다.

### 1. 네비게이션 & 라우팅

- `src/App.tsx`: `/outsource/tshirt-factory` 라우트 추가
- `src/components/AppLayout.tsx`: outsource 섹션에 `menu.outTshirtFactory` 메뉴 추가 (Shirt 아이콘)
- `src/contexts/LangContext.tsx`: KO/ZH 번역 키 추가

### 2. 데이터베이스 스키마 (Supabase 마이그레이션)

신규 테이블 5개를 `public` 스키마에 생성 (모두 RLS + GRANT 포함):

- **`tshirt_product_types`** — 상품 유형 마스터 (반팔/긴팔/후드티 확장용)
  - `code`, `name_ko`, `name_zh`, `sort_order`, `active`
- **`tshirt_colors`** — 색상 마스터
  - `code`, `name_ko`, `name_zh`, `hex`, `sort_order`, `active`
- **`tshirt_inventory`** — SKU별 재고 (product_type × color × size)
  - `product_type_code`, `color_code`, `size` (S~4XL enum), `in_stock`, `in_progress`, `available`, `safety_stock`
  - UNIQUE(product_type_code, color_code, size)
- **`tshirt_purchase_orders`** — 발주 헤더
  - `po_number` (PO-YYYY-NNNN 자동생성), `ordered_at`, `expected_at`, `received_at`, `product_type_code`, `color_code`, `status` (ordered/in_production/received/draft), `notes`, `created_by`
- **`tshirt_purchase_order_items`** — 발주 상세
  - `po_id`, `size`, `quantity`
- **`tshirt_purchase_order_attachments`** — 첨부파일 메타
  - `po_id`, `file_path`, `file_name`, `mime_type`, `size_bytes`

추가:
- enum `tshirt_size` (S, M, L, XL, 2XL, 3XL, 4XL)
- enum `tshirt_po_status` (draft, ordered, in_production, received)
- 시퀀스/함수로 `po_number` 자동 생성
- **입고 처리 트리거**: PO status가 'received'로 바뀌면 해당 PO items의 수량을 `tshirt_inventory.in_stock`에 가산 (그리고 `available` 재계산)
- 시드 데이터: 반팔 1종 + 색상 4종 + 사이즈 7종 = 28 SKU + 발주 이력 3~5건

### 3. Storage 버킷

- `tshirt-po-attachments` (private 버킷) — 발주 참고 도면 업로드용
- RLS 정책: authenticated 사용자만 업로드/조회

### 4. 프론트엔드 페이지

`src/pages/outsource/TshirtFactory.tsx` — 단일 페이지, 상단 Tabs:

**Tab 1: 재고 현황 + 발주 목록** (한 탭에 같이 표시)

- 상단: 4개 신호등 KPI 카드 (정상/부족/품절임박/품절)
- 중단: 안전재고 이하 경고 알림 리스트 + [발주하기] 버튼 (클릭 시 발주지시 탭으로 이동하며 상품 자동 선택)
- 하단: 상품 유형별 색상×사이즈 매트릭스 테이블 (셀에 수량 + 상태 아이콘 + 게이지 바, 클릭 시 상세 모달)
- 필터: 상품 유형 / 색상 / 사이즈 / 경고 상태만 보기 토글
- 발주 목록 섹션: 테이블 (발주번호, 발주일, 예상/실제 입고일, 종류, 색상, 사이즈별 수량, 합계, 상태, 액션)
  - [상세 보기] 모달, [입고 처리] 버튼 (status → received)
  - 상태/기간 필터, CSV 다운로드

**Tab 2: 발주 지시**

- 기본 정보 (발주일/예상입고일/작성자)
- 상품 선택 (티셔츠 종류 드롭다운 + 색상 선택)
- 수량 입력 매트릭스 (사이즈별 현재재고/안전재고 참고 표시 + 입력란 + 합계 자동계산, 부족 행에 경고 아이콘)
- 참고 도면 드래그&드롭 업로드 (PNG/JPG/PDF, 다중, 썸네일)
- 특이사항 textarea (최대 1000자 카운터)
- [임시 저장] / [발주 등록] 버튼

### 5. 컴포넌트 분리

가독성을 위해 일부 서브컴포넌트 분리:
- `src/pages/outsource/tshirt-factory/InventoryMatrix.tsx`
- `src/pages/outsource/tshirt-factory/PurchaseOrderList.tsx`
- `src/pages/outsource/tshirt-factory/PurchaseOrderForm.tsx`
- `src/pages/outsource/tshirt-factory/SkuDetailDialog.tsx`

### 기술 스택

shadcn/ui (Tabs, Table, Dialog, Card, Badge, Progress, Input, Textarea, Select, Calendar/DatePicker), Tailwind 시맨틱 토큰 사용, Supabase 클라이언트로 CRUD, Storage SDK로 첨부파일.

### 확인 필요

작성자 필드는 로그인 사용자 이메일로 자동 입력하면 될까요? (현재 useAuth 사용)
