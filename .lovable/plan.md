# 카드 바코드 인쇄 Fail-fast 및 READY 전환 수정

## 목표
- 프린터 Gateway 오류의 HTTP 상태와 상세 payload를 프록시가 손실 없이 전달합니다.
- 카드/티셔츠 인쇄를 단일 소비자, 1건씩 ACK 순서로 처리하고 첫 실패 즉시 뒤 작업을 `queued`로 유지합니다.
- 첫 출력 전 `RUN → READY 확인 → 출력` 절차를 적용하고 중복 인쇄 위험이 있는 프론트 자동 재POST를 제거합니다.
- `accepted`와 물리 출력 완료(`printed`)를 분리하고 구조화된 오류/타임라인 로그를 남깁니다.

## 구현 범위
1. **프록시 오류 보존**
   - 프린터 API 경로는 상위 Gateway의 status/body를 그대로 반환합니다.
   - Gateway가 구조화 필드를 주지 않는 기존 오류에는 프록시가 `error_code`, `retryable`, 가능한 `gateway_job_id`를 보강하되 원래 `detail`은 유지합니다.
   - 카메라 라이브 스트림의 기존 204/offline 예외 처리는 유지하여 다른 기능에 영향이 없게 합니다.

2. **프린터 클라이언트 계약 강화**
   - 성공을 `response.ok && accepted === true && 유효한 id`로만 판정합니다.
   - HTTP 200이어도 `offline`, `accepted:false`, `error/detail/error_code`가 있으면 실패로 처리합니다.
   - 문자열 포함 검사 기반 오류 분기를 제거하고 `error_code` 기반 결과 타입을 사용합니다.
   - 프론트의 timeout 자동 재POST를 제거합니다. `PRINTER_NAK`/`PRINTER_NOT_READY`만 READY 복구 후 최대 1회 재시도하고, timeout/disconnected/cancelled는 자동 재인쇄하지 않습니다.

3. **READY 웜업**
   - `/run` 후 고정 400ms/1.2초 대기를 제거합니다.
   - 상태 API를 300~500ms 간격, 최대 8초 동안 폴링하여 연결 및 RUN/READY 확인 후 첫 POST를 보냅니다.
   - Gateway status 응답의 `ready/running/run_state/state`를 호환 처리하고, READY 정보가 없는 구형 Gateway는 명확한 `PRINTER_NOT_READY`로 중단시켜 확인 없이 출력하지 않습니다.

4. **Single Consumer / Fail-fast**
   - 디스패처 실행 락을 유지하고 immutable scan sequence/position 오름차순으로 한 건씩 처리합니다.
   - 현재 POST 중인 한 건만 `dispatching`; ACK 후 `accepted`; Gateway 큐에서 처리 중이면 `printing`; 실제 완료 확인 시 `printed`; 실패 시 `error`로 구분합니다.
   - 첫 실패를 ref 수준에서도 즉시 halt하여 React state 반영 전 다음 루프가 진행되는 경쟁 조건을 차단합니다.
   - 재시도 후 재개는 실패한 선두 작업이 ACK된 뒤에만 다음 queued 작업을 처리합니다.
   - 수동 재인쇄/테스트 경로도 실패인데 완료 처리되는 현상을 함께 바로잡습니다.

5. **진단 로그 및 저장**
   - 작업별 position, barcode, gateway job id, dispatch/ACK/READY/printed 시각, run state, 응답 코드, retry count, error code/detail을 기록하고 상세 로그 화면에 표시합니다.
   - 서버 공유가 필요한 진단 필드는 `barcode_print_items`에 안전하게 추가하고 기존 RLS/권한을 유지합니다.

6. **검증**
   - 순수 디스패처 로직 테스트를 추가해 20건 순차 ACK, 첫 작업 timeout 시 `1 error + 2~20 queued`, 재개 순서, 동시 dispatch 최대 1건, 오류 payload 판정을 검증합니다.
   - 프록시 응답 보존과 성공 조건을 정적/단위 테스트로 검증합니다.
   - 실제 Gateway/프린터가 접근 가능하면 READY 시작, STOP/idle 시작, 강제 timeout 시나리오를 실행하고 실제 결과를 보고합니다. 하드웨어 또는 Gateway의 오류 주입 기능이 없으면 실행 불가 항목과 필요한 Gateway 변경을 구분해 보고합니다.

## Gateway 경계
- 시리얼 전송 여부를 판단한 동일 job id 내부 재시도, `retry_count`, `serial_send_at`, `serial_response_at`, startup ACK timeout 조정은 실제 Gateway 서버 구현이 이 저장소에 있을 때만 수정합니다.
- 구현이 외부 장비 서버에만 있으면 프록시는 오류를 보존하고 프론트는 위험한 timeout 재전송을 중단하며, Gateway 측 필수 변경 사양을 정확히 정리합니다.
