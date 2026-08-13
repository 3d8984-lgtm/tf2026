# 바코드 작업 초기화 권한 수정

## 변경 내용
- `barcode_print_resets`의 네 가지 RLS 정책이 권한이 폐기된 `public.is_approved()` 대신 보안 전용 `app_private.is_approved()`를 사용하도록 교체합니다.
- 관리자도 초기화할 수 있도록 기존 보안 패턴에 맞춰 `app_private.is_admin()` 조건을 함께 적용합니다.
- 적용 후 정책 정의와 초기화 기록 저장 가능 여부를 확인합니다.

## 기술 세부사항
- 새 마이그레이션에서 기존 SELECT/INSERT/UPDATE/DELETE 정책을 삭제한 뒤 같은 이름으로 재생성합니다.
- 프런트엔드 초기화 흐름은 유지하며 데이터 구조나 기존 작업 기록은 변경하지 않습니다.
