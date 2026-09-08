# QR 라벨 렌더러·Print Agent 분리 진단

## 목표
- 라벨 설정 미리보기가 아닌, Print Agent 직전에 생성된 최종 래스터 이미지를 화면과 PNG 파일로 확인합니다.
- Lovable이 만든 결과가 정상인지, Agent 또는 Windows 드라이버에서 변형되는지 동일 파일로 비교합니다.
- 좌표나 Y 오프셋은 변경하지 않습니다.

## 작업 내용
1. **최종 래스터 출력물을 단일 기준으로 생성**
   - 현재 라벨 PDF를 선택된 프린터 DPI로 한 장의 PNG에 래스터화합니다.
   - 인쇄 시에는 이 PNG를 정확한 mm 크기의 단일 PDF 페이지에 1:1로 넣어 Agent에 전달합니다.
   - 화면 확인, PNG 다운로드, Agent 출력이 모두 같은 PNG 바이트를 사용하게 합니다.

2. **물리 크기와 픽셀 크기 검증**
   - 폭은 `라벨 폭 × 열 + 가로 간격 × (열-1) + 좌우 여백`으로 계산합니다.
   - 높이는 `라벨 높이 × 행 + 세로 간격 × (행-1) + 상하 여백`으로 계산합니다.
   - `pixel = round(mm / 25.4 × DPI)` 공식으로 생성 크기를 고정합니다.
   - 최종 화면에 Physical Width/Height, Pixel Width/Height, DPI, Columns, Rows, Label Width/Height, Horizontal/Vertical Pitch를 표시합니다.

3. **Agent payload 진단 강화**
   - job ID, 프린터명, mm/px 크기, DPI, 이미지 형식, 방향, 복사 수, media/page 크기, scale, fit/stretch/resize/crop/rotate/slicing 여부를 구조화 로그로 남깁니다.
   - Agent 요청에 100% 배율, PDF 페이지 크기 사용, fit/shrink/resize/rotate/crop/slicing 비활성 값을 쿼리와 헤더로 명시합니다.
   - 개별 라벨 높이가 아니라 전체 문서 높이를 page/media 높이로 전송합니다.

4. **Agent 우회 비교**
   - 같은 최종 PNG를 다운로드해 Windows 기본 이미지 인쇄나 다른 프로그램에서 출력할 수 있게 합니다.
   - 화면에 Agent 출력과 외부 프로그램 출력의 판정 기준을 명확히 표시합니다.

5. **검증**
   - 15mm 라벨, 2mm 간격, 5열×10행, 300 DPI에서 83×168mm 및 약 980×1984px인지 자동 검사합니다.
   - 생성 PNG와 Agent에 넣는 래스터가 동일한지, PDF가 한 페이지이고 페이지 크기가 전체 문서 크기인지 검사합니다.
   - 실제 주문 화면에서 최종 이미지 표시와 PNG 다운로드 버튼을 확인합니다.

## 기술 세부사항
- 현재 저장소에는 Local Print Agent 실행 코드가 없고 브라우저 클라이언트만 있으므로, Agent 내부의 드라이버 렌더링·페이지 분할 여부를 직접 수정할 수는 없습니다.
- 대신 Agent에 들어가는 최종 이미지를 고정하고 모든 자동 변환 금지 신호와 전체 페이지 크기를 함께 보내, 입력 단계까지를 검증 가능하게 만듭니다.
- 동일 PNG가 외부 프로그램에서는 정상이고 Agent 출력만 비정상이면 Agent/드라이버 문제로 확정할 수 있습니다.