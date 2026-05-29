
# 업스케일링 최적화 적용 계획

교육자료(`Lovable_업스케일링_교육패키지.zip`)의 의사결정 매트릭스를 외주 공정 전체에 적용합니다.
적용 방식: **A) 무료 클라이언트 최적화 + B) Real-ESRGAN(Replicate) AI 업스케일 (사용자가 선택)**.

---

## 1. 공통 유틸 신설 — `src/lib/upscale.ts`

지금 `LogoFactory.tsx` / `HeatTransferFactory.tsx` 등에 **각자 복붙된** `edgePreservingUpscale` 을 하나로 통합하고,
교육자료의 Decision Matrix 를 코드로 옮깁니다.

### 1.1 입력 이미지 자동 분석 `analyzeImage(img)`
- **transparency**: 알파 히스토그램(0/255 비율) → 투명 배경 여부
- **palette**: 고유 색 수 추정 (다운샘플 후 카운트) → 일러스트/로고/사진 판별
- **edginess**: Sobel 평균 → 라인아트/텍스트성 강도
- **noise**: 고주파 분산 → 압축 노이즈/사진 여부
- **isPixelArt**: 작은 해상도 + 적은 팔레트 + 하드엣지 시그니처
- **hasText**: 가로 스트로크 클러스터 휴리스틱 (간이)
- **결과 타입**: `'pixel_art' | 'line_art_logo' | 'illustration' | 'document_text' | 'photo'`

### 1.2 알고리즘 분기 `pickAlgo(analysis, options)`
교육자료 SECTION 3 표를 그대로 반영:

| 입력 타입       | 클라이언트 알고리즘                       | AI 옵션(켰을 때)       |
|----------------|------------------------------------------|------------------------|
| pixel_art      | Nearest-Neighbor 정수배                  | 사용 안 함             |
| line_art_logo  | Lanczos3 + 강한 Unsharp + 알파 이진화    | Real-ESRGAN-anime      |
| illustration   | Lanczos3 + 색평탄화(blur on chroma)      | Real-ESRGAN-anime      |
| document_text  | Lanczos3 + 강 샤프닝 + 알파 이진화       | SwinIR(or Real-ESRGAN) |
| photo          | Lanczos3 + 약 샤프닝 + 노이즈 무시 임계  | Real-ESRGAN(general)   |

### 1.3 핵심 구현
- **Lanczos3 리샘플러** (신규): 현재 반복 Bilinear 대신 1-shot Lanczos3.
  - WebGL 백업 없이도 충분히 빠름. 단일 패스 → 흐림/엣지 정확도 향상.
- **언샤프 마스크**: 가우시안(σ 가변, 현재 3×3 박스블러 대체), `amount`/`threshold` 를 타입별 프리셋 제공.
- **알파 정리**: 투명 PNG 입력 시에만 동작. 임계 24/232 → 타입별 동적 조정.
- **색평탄화 (illustration)**: HSL 채도/명도 양자화로 anime 모델 효과 흉내.
- **목표 크기**: 현재처럼 `(mm × dpi/25.4)` 픽셀로 계산.

### 1.4 진입점
```ts
export async function smartUpscale(
  img: HTMLImageElement | HTMLCanvasElement,
  targetW: number, targetH: number,
  opts?: { mode?: 'auto' | 'photo' | 'logo' | 'illustration' | 'text' | 'pixel';
           sharpness?: number; useAI?: boolean }
): Promise<{ canvas: HTMLCanvasElement; analysis: Analysis; method: string }>;
```
- `useAI: true` 면 Edge Function 호출(아래 §2), 실패 시 클라이언트 폴백.

---

## 2. AI 업스케일 — Edge Function `upscale-image`

Replicate 커넥터(게이트웨이)로 Real-ESRGAN / Real-ESRGAN-anime / GFPGAN 호출.

### 2.1 커넥터 연결
- `standard_connectors--connect(connector_id="replicate")` 호출 → 사용자가 연결.
- 연결 전에는 UI 의 'AI 업스케일' 토글이 **disabled** + 안내 문구.

### 2.2 Edge Function 동작
- 입력: `{ imageBase64, scale: 2|4, kind: 'general'|'anime'|'face' }`
- 처리:
  1. base64 → Replicate Files API 업로드
  2. `kind` 에 따른 모델 호출:
     - `general` → `nightmareai/real-esrgan` (또는 `xinntao/realesrgan-x4plus`)
     - `anime`   → `xinntao/realesrgan-x4plus-anime`
     - `face`    → `tencentarc/gfpgan` (+ bg_upsampler)
  3. polling → output URL → fetch → base64 반환
- 응답: `{ imageBase64, model, ms }`
- 에러: 429/402/모델 실패 시 명확한 메시지(클라이언트에서 토스트 + 자동 클라이언트 폴백).

### 2.3 보안 / 제한
- `verify_jwt = true` (인증 사용자만)
- 입력 크기 상한(예: 8MB) Zod 검증
- 가격 안내 토스트(첫 호출 시 한 번)

---

## 3. UI 변경 — 5개 외주 페이지 공통

대상: `LogoFactory.tsx`, `HeatTransferFactory.tsx`, `SiliconFactory.tsx`, `HologramFactory.tsx`, `NfcCardFactory.tsx`

각 페이지의 "업스케일" 컨트롤 옆에 다음 추가:
1. **모드 셀렉트**: `자동 / 로고 / 일러스트 / 텍스트 / 사진 / 픽셀` (기본 자동)
2. **샤프니스 슬라이더**: 0–100 (기본 50)
3. **'고품질 AI 업스케일' 토글**: Real-ESRGAN 호출. Replicate 미연결 시 비활성 + "연결하기" 버튼.
4. 결과 미리보기 아래에 `analysis.type` 과 `method` 라벨 표시(교육자료 응답 템플릿과 동일 형식).

기존 `edgePreservingUpscale` 호출부는 전부 `smartUpscale(...)` 로 교체.
다운로드 / PDF / 인쇄 미리보기 경로의 픽셀 크기 계산 로직(`mm × dpi/25.4`)은 그대로 유지 — 알고리즘만 교체.

---

## 4. 마이그레이션 / 백워드 호환

- 기존 동작(샤프닝된 결과) 과 시각적으로 동등하거나 더 나음.
- 투명 PNG 입력 → 투명 유지(이전 수정 사항 보존).
- PDF 헤더/푸터 제거 상태 유지.
- 픽셀 아트 입력은 자동으로 Nearest-Neighbor 로 빠지므로 기존 흐림 없음.

---

## 5. 작업 단계

1. `src/lib/upscale.ts` 신설 (analyzeImage, Lanczos3, Unsharp, smartUpscale).
2. `standard_connectors--connect` 로 Replicate 연결 요청.
3. `supabase/functions/upscale-image/index.ts` 생성 + 배포.
4. 5개 외주 페이지에서 로컬 `edgePreservingUpscale` 제거, `smartUpscale` 사용.
5. 모드/샤프니스/AI 토글 UI 추가.
6. QA: 로고(투명 PNG), 사진 JPG, 일러스트 PNG, 텍스트 스캔 각각 다운로드 결과 비교.

## 기술 노트

- Lanczos3 커널: `L(x) = sinc(x)·sinc(x/3)`, support=3, 분리 가능 1D 컨볼루션 2회로 적용. 큰 이미지에서도 단일 패스로 충분.
- 가우시안 언샤프: σ=0.8 커널 5×5, `out = base + amount*(base - blur)`, `|diff|<threshold` 시 무시.
- 알파 이진화 임계: line_art_logo 는 32/224, document_text 는 48/208.
- Replicate 호출은 게이트웨이 (`connector-gateway.lovable.dev/replicate/v1`) 사용, `LOVABLE_API_KEY` + `LOVABLE_CONNECTOR_REPLICATE_API_KEY` 헤더 필수.
