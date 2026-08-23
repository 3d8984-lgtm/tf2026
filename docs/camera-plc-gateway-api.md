# Camera / PLC Gateway API — 프론트엔드 연동 문서

이 문서는 대시보드/워크플로우 프론트엔드를 만드는 개발자/에이전트를 위한 전체 API
레퍼런스입니다. 서버 소스코드를 읽지 않고 이 문서만으로 연동할 수 있도록 작성했습니다.

## 새로 연동하실 때 먼저 읽어주세요

- **`/api/v1/print/*`(구형 Cosofteck 프린터)는 사용 중단(deprecated)입니다.** 클라이언트가
  이 프린터를 더 이상 안 써서 신규 연동 대상에서 제외됩니다 — 엔드포인트 자체는 남아있지만
  (과거 데이터 조회 등 대비, 삭제 안 함) **새 프론트엔드는 이 섹션을 쓰지 마세요.**
- **바코드/QR 인쇄는 `/api/v2/pf-printer/*`(PF 신형 프린터)를 쓰세요** — 실기 검증 완료
  상태입니다.
- **바코드/QR "카드 스캐너"는 `/api/v1/scan/*`(MQTT 고정 스캐너) 하나뿐입니다.** 그 외
  스캔(카드-티셔츠 대조, 택배 송장용 스캔 등)은 이 서버가 관여하지 않고 프론트엔드에서
  자체적으로(카메라/핸드헬드 스캐너 등) 처리하는 것으로 가정합니다 — 이 문서에는 없습니다.
- **버전 정책**: `/api/v1`은 기존 엔드포인트 유지용, 앞으로 새로 추가되는 엔드포인트는 전부
  `/api/v2` 아래에 생깁니다. 아래 목록에서 v1/v2 표시를 확인하세요.

## 기본 정보

- **Base URL**: `http://<host>:8000` (배포마다 다름 — 운영자에게 확인)
- **API prefix**: `/api/v1`(기존, `print`만 deprecated) / `/api/v2`(신규 추가분 — 현재는
  PF 프린터만 있음, 앞으로 계속 늘어남).
- **인증 없음**: 현재 이 API는 인증/인가가 없습니다. 내부망 전용으로 설계됨 — 인터넷에 직접
  노출하지 마세요.
- **CORS**: 기본적으로 모든 오리진 허용(`*`). 브라우저에서 바로 fetch/XHR 가능.
- **Content-Type**: 요청 바디는 `application/json`. 응답도 JSON (라이브 스트림 파일, JPEG, MP4
  제외).
- **시간 형식**: 모든 시각 파라미터/응답은 ISO 8601. 타임존을 반드시 포함해서 보내는 걸 권장
  (예: `2026-07-21T03:29:50+09:00` 또는 UTC `2026-07-21T03:29:50Z`). 응답의 시각 필드는 항상
  UTC(`Z` suffix)로 내려줍니다.
- **에러 응답 형식**: 두 가지가 섞여 있습니다. FastAPI가 요청 파라미터 자체를 자동 검증해서
  걸러내는 경우(주로 422) — `id` 형식, 쿼리 타입 등 — 는 `{"detail": [{"type":..., "loc":..., "msg":...}]}`
  처럼 `detail`이 **배열**입니다. 그 외 애플리케이션 로직에서 명시적으로 낸 에러(404/409/422 일부/
  501/502/503/500)는 `{"detail": "사람이 읽을 수 있는 설명"}`처럼 `detail`이 **문자열**입니다.
  프론트에서는 `typeof detail === "string" ? detail : detail.map(e => e.msg).join(", ")`처럼
  둘 다 처리하는 게 안전합니다.

---

## 카메라 API

### 카메라 생명주기 개념

카메라는 **설정(config)**과 **실행 상태(recording)**가 분리되어 있습니다.

- `enabled: true` (설정) → 서버가 그 카메라의 ffmpeg 녹화 프로세스를 **실행하려고 시도**함
- `recording: true` (실행 상태) → 실제로 지금 ffmpeg 프로세스가 **떠 있음** (라이브 스트림 재생 가능)

카메라를 켜거나(`enabled` → true) 설정을 바꾸면 서버가 즉시 recorder를 재시작하므로, 응답이
온 직후 아주 짧은 순간(보통 1초 이내) `recording`이 아직 `false`로 보일 수 있습니다. 확실히
알고 싶으면 잠시 후 `GET /api/v1/cam`으로 다시 확인하거나, `GET /healthz`를 폴링하세요.

**녹화(recording)를 끄면 라이브 스트리밍도 함께 꺼집니다** — 하나의 ffmpeg 프로세스가 라이브와
아카이브(저장)를 동시에 만들어내는 구조라 둘을 분리해서 켤 수 없습니다. 과거 녹화 데이터는
녹화를 꺼도 그대로 남아있고 `/clip`, `/seek`, `/recordings`로 계속 조회 가능합니다.

카메라를 **삭제**해도 디스크에 저장된 녹화 파일은 지우지 않습니다 (실수 방지). 관리자가 서버에서
직접 지워야 합니다.

---

### `GET /api/v1/cam`

등록된 모든 카메라 목록과 현재 상태.

**응답 200**
```json
[
  {
    "id": "cam0",
    "input_url": "rtsp://192.168.1.50:554/stream1",
    "rtsp_transport": "tcp",
    "live_transcode": false,
    "enabled": true,
    "recording": true,
    "live_playlist": "/api/v1/cam/cam0/live/stream.m3u8"
  }
]
```
- `live_playlist`는 `recording`이 `true`일 때만 값이 있고, 아니면 `null`.

---

### `POST /api/v1/cam`

카메라 추가. `enabled`가 기본 `true`라 생성 즉시 녹화가 시작됩니다.

**요청 바디**
```json
{
  "id": "cam1",
  "input_url": "rtsp://192.168.1.51:554/stream1",
  "rtsp_transport": "tcp",
  "live_transcode": false,
  "enabled": true
}
```
| 필드 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `id` | O | - | 영문/숫자/`-`/`_`만 허용. URL과 저장 디렉터리명에 그대로 쓰임 |
| `input_url` | X | `"testsrc"` | `rtsp://...` 실제 카메라 주소. `"testsrc"`면 합성 테스트 영상(하드웨어 없이 검증용) |
| `rtsp_transport` | X | `"tcp"` | RTSP 전송 프로토콜, 보통 안 바꿔도 됨 |
| `live_transcode` | X | `false` | 카메라가 H.265 등 브라우저 비호환 코덱이면 `true` (느려짐, CPU 사용) |
| `enabled` | X | `true` | `false`로 만들면 등록만 하고 녹화는 안 시작 |

**응답 201** — `GET /api/v1/cam`의 항목 하나와 동일한 형태.

**에러**
- `409` — 이미 존재하는 `id`
- `422` — `id` 형식이 잘못됨 (허용 문자 외 포함 등)

---

### `GET /api/v1/cam/{camera_id}/config`

카메라 원본 설정 조회 (`recording` 실행상태 없이 순수 설정값만).

**응답 200**
```json
{
  "id": "cam0",
  "input_url": "rtsp://192.168.1.50:554/stream1",
  "rtsp_transport": "tcp",
  "live_transcode": false,
  "enabled": true
}
```
**에러**: `404` — 없는 `camera_id`

---

### `PATCH /api/v1/cam/{camera_id}/config`

카메라 설정 부분 수정. **보낸 필드만 반영**되고, 저장 후 즉시 recorder를 재시작해서 반영합니다
(카메라가 꺼져 있었다면 계속 꺼진 채로 설정만 바뀜).

**요청 바디** (전부 선택, 보낸 것만 적용)
```json
{ "input_url": "rtsp://192.168.1.51:554/stream1", "live_transcode": true }
```
**응답 200** — `GET /api/v1/cam` 항목과 동일한 형태 (갱신된 값 + 실행상태 포함).

**에러**: `404` — 없는 `camera_id`

> `enabled`도 이 엔드포인트로 바꿀 수 있지만, 녹화 on/off만 목적이라면 아래
> `POST /{camera_id}/recording`을 쓰는 게 의도가 더 명확합니다.

---

### `DELETE /api/v1/cam/{camera_id}`

카메라 삭제 (설정에서 제거 + 실행 중이면 정지). **저장된 영상 파일은 삭제하지 않습니다.**

**응답 204** (바디 없음)

**에러**: `404` — 없는 `camera_id`

---

### `POST /api/v1/cam/{camera_id}/recording`

녹화(=라이브+아카이브) on/off.

**요청 바디**
```json
{ "enabled": false }
```
**응답 200** — `GET /api/v1/cam` 항목과 동일한 형태.

**에러**: `404` — 없는 `camera_id`

---

### `GET /api/v1/cam/{camera_id}/recordings?start=&end=`

지정한 시간 범위 안에서 **실제로 녹화가 존재하는 연속 구간**을 조회. 클립을 따기 전에 어느
시간대가 녹화되어 있는지 확인하는 용도 (타임라인 UI에 바로 사용 가능).

**쿼리 파라미터**
| 이름 | 필수 | 설명 |
|---|---|---|
| `start` | O | 조회 시작 시각 (ISO 8601) |
| `end` | O | 조회 종료 시각 (ISO 8601), `start`보다 이후여야 함 |

조회 범위는 최대 31일 (서버 설정 `MAX_RECORDINGS_QUERY_DAYS`).

**응답 200**
```json
{
  "camera_id": "cam0",
  "start": "2026-07-21T00:00:00Z",
  "end": "2026-07-22T00:00:00Z",
  "ranges": [
    { "start": "2026-07-21T00:00:00Z", "end": "2026-07-21T03:12:45Z", "duration_sec": 11565.0 },
    { "start": "2026-07-21T03:15:00Z", "end": "2026-07-22T00:00:00Z", "duration_sec": 74700.0 }
  ]
}
```
`ranges`가 비어있으면 그 구간에 녹화가 전혀 없다는 뜻 (카메라가 꺼져 있었거나, 보관기간이
지나 삭제됐거나, 아직 그 시점 이후라 존재하지 않음).

**에러**
- `404` — 없는 `camera_id`
- `422` — `end <= start`, 또는 조회 범위가 최대 일수를 초과

---

### `GET /api/v1/cam/{camera_id}/live/stream.m3u8`

라이브 HLS 플레이리스트. `hls.js`나 Safari의 네이티브 HLS 재생으로 바로 재생 가능. 세그먼트
파일(`seg_00000001.ts` 등)은 플레이리스트가 참조하는 상대경로 그대로
`/api/v1/cam/{camera_id}/live/seg_NNNNNNNN.ts`에서 서빙됩니다 — 별도 처리 없이 `<video>` 태그나
hls.js에 플레이리스트 URL만 넘기면 됩니다.

**에러**
- `404` — 없는 `camera_id`, 또는 현재 `recording=false`(녹화 꺼짐)

---

### `GET /api/v1/cam/{camera_id}/seek?at=`

특정 시각 근처 프레임 1장을 JPEG로 반환 — 클립을 자르기 전에 "이 시간대가 맞나" 대충
확인하는 용도 (빠름, 무거운 클립 생성 없음).

**쿼리 파라미터**: `at` (ISO 8601, 필수)

**응답 200**: `Content-Type: image/jpeg`, 바이너리 이미지

**에러**
- `404` — 없는 `camera_id`, 또는 그 시각 근처에 녹화 자체가 없음
- `500` — ffmpeg 프레임 추출 실패

---

### `GET /api/v1/cam/{camera_id}/clip?start=&duration=&precise=`

구간 클립을 MP4로 추출. 카메라의 원본 코덱(예: HEVC)과 무관하게 **항상 H.264/AAC로 재인코딩**해서
반환합니다 — 브라우저/플레이어 호환성 때문에 스트림 카피는 하지 않습니다.

**쿼리 파라미터**
| 이름 | 필수 | 설명 |
|---|---|---|
| `start` | O | 클립 시작 시각 (ISO 8601) |
| `duration` | O | 길이(초), 1 이상, 서버 설정 `MAX_CLIP_DURATION_SEC`(기본 360) 이하 |
| `precise` | X | 탐색 방식만 다름 (코덱은 둘 다 H.264로 동일). 기본 `false`는 목표 지점 근처로 빠르게 점프한 뒤 인코딩 — 빠르지만 시작 지점이 키프레임 단위로 최대 몇 초 밀릴 수 있음. `true`는 클립에 쓰인 구간 전체를 처음부터 디코딩해서 프레임 단위로 정확히 자름 — 느림, 특히 concat된 구간이 길수록 |

**응답 200**: `Content-Type: video/mp4`, 파일 다운로드

요청 구간 안에 녹화 공백(예: ffmpeg 재시작으로 인한 몇 초간의 끊김)이 있어도 에러 없이 처리합니다
— 공백 부분은 건너뛰고 실제 존재하는 구간들만 이어붙여서 반환합니다. 즉 반환된 클립의 실제
길이가 요청한 `duration`보다 짧을 수 있습니다 (공백만큼 빠짐). 정확히 어디에 공백이 있는지 미리
알고 싶으면 `/recordings`로 실제 녹화 구간을 확인하세요.

**에러**
- `404` — 없는 `camera_id`, 또는 해당 시간대에 녹화가 전혀 없음 (요청 구간과 겹치는 세그먼트가
  하나도 없는 경우)
- `422` — `duration`이 범위를 벗어남

---

## PLC API

WECON PLC와 Modbus로 통신합니다. 카메라처럼 **PLC도 여러 대 등록 가능**하고 각각
`/api/v1/plc/{plc_id}/...`로 노출됩니다 (실제 현장은 `plc0`, `plc1` 2대).

**⚠️ PLC마다 실제 벤더 레지스터 맵이 다르고, 그래서 지원되는 기능도 PLC마다 다릅니다** —
`register_profile` 필드로 구분됩니다 (`GET /api/v1/plc`, `.../config` 응답에 포함):

| `register_profile` | 상태/알람 | 카운팅(`total_count`) | 원격 시작/정지 |
|---|---|---|---|
| `simple_counter` (현장 `plc0`) | ✅ | ✅ PLC 레지스터 직접 | ❌ (`501`) |
| `belt_cutter` (현장 `plc1`) | ✅ | ❌ 항상 `0` (레지스터 없음, 미구현) | ✅ |

요청된 6개 기능 중, PLC 레지스터로 직접 되는 것과 서버가 합성하는 것이 섞여 있습니다 —
**3개(카운팅 초기화/포장 길이/작동시간)는 PLC 레지스터가 아니라 항상 서버가 계산/추적한
값**입니다 (아래 필드별 설명 참고).

### PLC 생명주기 개념

카메라와 동일하게, PLC 설정도 DB 없이 `STORAGE_ROOT/plcs.json` 파일 하나로만 관리됩니다.
`POST`/`PATCH`/`DELETE`로 등록·수정·삭제하면 그 즉시 파일에 반영되고, 서버가 재시작 없이
해당 PLC의 백그라운드 가동시간 모니터(polling task)를 새로 시작/재시작/정지시킵니다.

---

### `GET /api/v1/plc`

등록된 PLC 목록.

**응답 200**
```json
[
  { "id": "plc0", "connection_mode": "tcp", "host": "192.168.8.8", "port": 502, "serial_port": null, "register_profile": "simple_counter" },
  { "id": "plc1", "connection_mode": "tcp", "host": "192.168.9.9", "port": 502, "serial_port": null, "register_profile": "belt_cutter" }
]
```
`connection_mode`가 `"tcp"`면 `host`/`port`만 값이 있고 `serial_port`는 `null`, `"rtu"`면 반대.
`register_profile`은 위 표 참고 — PLC별 실제 지원 기능이 이 값에 따라 달라짐.

---

### `POST /api/v1/plc`

PLC 추가. 등록 즉시 가동시간 모니터가 시작됩니다.

**요청 바디**
```json
{
  "id": "plc2",
  "connection_mode": "tcp",
  "host": "192.168.10.10",
  "port": 502,
  "length_per_count_m": 0.5
}
```
| 필드 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `id` | O | - | 영문/숫자/`-`/`_`만 허용. URL에 그대로 쓰임 |
| `connection_mode` | X | `"tcp"` | `"tcp"` 또는 `"rtu"` |
| `host` | X | `"192.168.1.100"` | `connection_mode="tcp"`일 때 사용 |
| `port` | X | `502` | `connection_mode="tcp"`일 때 사용 |
| `serial_port` | X | `"/dev/ttyUSB0"` | `connection_mode="rtu"`일 때 사용 |
| `serial_baudrate` | X | `9600` | `connection_mode="rtu"`일 때 사용 |
| `unit_id` | X | `1` | Modbus 유닛(슬레이브) ID |
| `timeout_sec` | X | `3.0` | 연결/응답 타임아웃(초) |
| `length_per_count_m` | X | `null` | 카운트 1당 포장 길이(m). 안 넣으면 `packaged_length_m`이 계속 `null` |
| `register_profile` | X | `"simple_counter"` | `"simple_counter"` 또는 `"belt_cutter"` — 벤더 레지스터 맵 종류, PLC API 섹션 상단 표 참고 |

**응답 201** — `GET /api/v1/plc`의 항목 하나와 동일한 형태.

**에러**
- `409` — 이미 존재하는 `id`
- `422` — `id` 형식이 잘못됨

---

### `GET /api/v1/plc/{plc_id}/config`

PLC 원본 설정 조회 (연결 정보 전체, `serial_baudrate`/`unit_id`/`timeout_sec`/`length_per_count_m` 포함).

**에러**: `404` — 없는 `plc_id`

---

### `PATCH /api/v1/plc/{plc_id}/config`

PLC 설정 부분 수정. **보낸 필드만 반영**되고, 저장 후 즉시 해당 PLC의 가동시간 모니터를
재시작해서 반영합니다.

**요청 바디** (전부 선택, 보낸 것만 적용)
```json
{ "length_per_count_m": 0.5 }
```
**응답 200** — `GET /api/v1/plc` 항목과 동일한 형태 (갱신된 값 포함).

**에러**: `404` — 없는 `plc_id`

---

### `DELETE /api/v1/plc/{plc_id}`

PLC 삭제 (설정에서 제거 + 가동시간 모니터 정지).

**응답 204** (바디 없음)

**에러**: `404` — 없는 `plc_id`

---

### `GET /api/v1/plc/{plc_id}/status`

**응답 200**
```json
{
  "state": "running",
  "running": true,
  "target_count_reached": false,
  "e_stop": false,
  "faults": [],
  "total_count": 123456,
  "packaged_length_m": 308640.0,
  "operating_seconds": 3600,
  "operating_duration": "1:00:00",
  "timestamp": "2026-07-24T02:24:45.155576Z"
}
```
| 필드 | 설명 |
|---|---|
| `state` | `running` \| `stopped` \| `fault` \| `e_stop` \| `unknown` (종합 상태, UI 뱃지용) |
| `running` | 구동 중 여부 |
| `target_count_reached` | 목표 생산량 도달 여부 — 두 `register_profile` 모두 이 값에 대한 레지스터가 없어서 **항상 `false`** |
| `e_stop` | 비상정지 버튼 눌림 여부 |
| `faults` | 활성 오류 코드 배열 (비어있으면 정상). `register_profile=simple_counter`는 12종, `belt_cutter`는 `low_temp_alarm`이 추가로 있어 13종: `color_mark_alarm`, `cut_alarm`, `servo_alarm`, `cutter_photo_eye_fault`, `blade_encoder_fault`, `film_encoder_fault`, `parameter_error`, `blade_servo_alarm`, `film_servo_alarm`, `material_servo_alarm`, `no_film_alarm`, (`belt_cutter`만) `low_temp_alarm`. `e_stop`은 이 배열에 안 들어가고 위 `e_stop` 필드로만 표시됨 |
| `total_count` | 누적 생산(카운팅) 수량. `register_profile=simple_counter`(PLC 레지스터 직접)만 정확한 값이고, `belt_cutter`는 카운터 레지스터가 없어서 **항상 `0`** (README "알려진 제한사항" 참고). `POST /control`의 `reset_counter`로 초기화한 시점 이후분만 표시 (서버가 오프셋 관리, PLC 원본 레지스터 자체는 못 지움) |
| `packaged_length_m` | 지금까지 포장한 길이(m) = `total_count × length_per_count_m`(PLC별 설정값). 설정 안 돼있으면 `null` — PLC 레지스터 아니라 서버 계산값. `total_count`가 항상 `0`인 PLC(`belt_cutter`)에서는 이 값도 항상 `0` |
| `operating_seconds` | 가동 시간(초). PLC 레지스터 아니라 서버가 5초(기본) 간격 폴링으로 `running=true`인 시간을 누적 추적. **PLC 연결이 끊기면(전원 꺼짐 등) 0으로 초기화** — 전체 누적이 아니라 마지막 연결 유지 구간 기준 |
| `operating_duration` | `operating_seconds`를 `"H:MM:SS"`(하루 넘으면 `"D day(s), H:MM:SS"`) 문자열로 표현한 값 |

**에러**
- `404` — 없는 `plc_id`
- `503` — PLC에 연결할 수 없음 (네트워크/전원 문제 등)
- `502` — PLC가 통신은 됐지만 비정상 응답을 반환함

---

### `POST /api/v1/plc/{plc_id}/control`

**요청 바디**
```json
{ "command": "start" }
```
`command`는 `"start"` \| `"stop"` \| `"reset_counter"` 중 하나.
- `start`/`stop`: PLC 레지스터에 직접 씀 (해당 비트에 `1`을 썼다가 잠깐 후 `0`으로 되돌리는
  펄스 방식 — 물리 버튼을 순간 누르는 것과 동일). `register_profile=simple_counter`인 PLC(현장
  `plc0`)는 이 레지스터 자체가 문서화되어 있지 않아서 `start`/`stop` 요청 시 항상 `501`
- `reset_counter`: PLC에 쓰지 않고, 서버가 그 시점의 원시 카운트를 오프셋으로 저장 — 이후
  `/status`의 `total_count`가 0부터 다시 세는 것처럼 보임 (아래 필드 설명 참고). `total_count`가
  애초에 항상 `0`인 PLC(`belt_cutter`)에서는 의미 없는 동작이지만 에러는 안 남

**응답 200**
```json
{ "accepted": true, "command": "start", "timestamp": "2026-07-24T02:24:45.309675Z" }
```

**에러**
- `404` — 없는 `plc_id`
- `501` — `start`/`stop`/`reset_counter` 외의 알 수 없는 `command` 문자열, 또는 이 PLC의
  `register_profile`에 해당 레지스터가 문서화되어 있지 않음 (예: `simple_counter`에 `start`/`stop`)
- `503` — PLC에 연결할 수 없음 (`reset_counter`도 오프셋 계산을 위해 PLC를 한 번 읽으므로, PLC가
  꺼져있으면 이 명령도 503)
- `502` — PLC가 쓰기 요청을 거부함

---

## 스캔 카운트 API (MQTT)

PLC와는 완전히 별개의 서브시스템입니다. 바코드 스캐너가 스캔할 때마다 공개 MQTT 브로커
(`broker.emqx.io:1883`, 토픽 `AMU262052715/dp`)로 이벤트를 발행하고, 서버가 백그라운드에서
구독해서 아래 API로 노출합니다 (`app/services/mqtt_client.py`). 카메라/PLC처럼 여러 대
등록하는 구조가 아니라 스캐너 한 대 전용 — `.env`의
`MQTT_BROKER_HOST`/`MQTT_BROKER_PORT`/`MQTT_TOPIC`로만 설정합니다.

실제 페이로드는 필드명이 소문자이고, 한 메시지에 스캔 여러 건이 `barcode_list`로 배치될 수
있습니다 (자세한 형식과 처리 방식은 README "바코드 스캐너 카운트 (MQTT)" 섹션 참고).

### `GET /api/v1/scan/status`

**응답 200**
```json
{
  "count": 15,
  "last_barcode": "880123456789",
  "last_duration": 2,
  "last_seen": "2026-08-04T09:14:26.803049Z",
  "connected": true
}
```
| 필드 | 설명 |
|---|---|
| `count` | 현재 누적 스캔 카운트. 기기가 보낸 `js` 값을 그대로 신뢰(서버가 직접 세지 않음), `POST /scan/reset`으로 초기화한 시점 이후분만 표시 |
| `last_barcode` | 마지막으로 스캔된 바코드/QR 내용. 아직 하나도 안 들어왔으면 `null` |
| `last_duration` | 마지막 스캔과 그 이전 스캔 사이 간격(초) — 기기가 보낸 `DURATION` 값 그대로 |
| `last_seen` | 마지막 스캔 이벤트를 서버가 수신한 시각. 아직 하나도 없으면 `null` |
| `connected` | 서버가 지금 MQTT 브로커에 연결되어 있는지. `false`면 `count` 등은 마지막으로 받은 값에서 멈춰있는 상태 |

이 엔드포인트 자체는 에러를 내지 않습니다 (MQTT 연결 문제는 `connected: false`로만 표시).

---

### `GET /api/v1/scan/history`

`/status`는 최신 1건만 보여주지만, 이건 **스캔 이력 전체**(최근 200건, 오래된 순)를 보여줍니다.
각 스캔이 만든 인쇄 작업의 상태를 조회 시점에 `/print/queue`와 같은 소스(`print_queue`)에서
가져와 같이 내려줍니다 — 인쇄 성공 여부를 두 곳에서 따로 관리하지 않기 위함입니다.

**응답 200**
```json
{
  "events": [
    {
      "id": "a1b2c3d4",
      "barcode": "880123456789",
      "scanned_at": "2026-08-04T09:14:26.803049Z",
      "duration": 2,
      "print_status": "done",
      "printed": true
    },
    {
      "id": "e5f6a7b8",
      "barcode": "880123456790",
      "scanned_at": "2026-08-04T09:15:01.000000Z",
      "duration": 1.5,
      "print_status": "failed",
      "printed": false
    }
  ]
}
```
| 필드 | 설명 |
|---|---|
| `barcode` | 그 시점에 스캔된 바코드/QR 내용 |
| `scanned_at` | 서버가 그 스캔 이벤트를 수신한 시각 (날짜+시간) |
| `duration` | 기기가 보낸 `DURATION` 값 (이전 스캔과의 간격, 초) |
| `print_status` | 이 스캔이 만든 인쇄 작업의 현재 상태: `pending`\|`printing`\|`done`\|`failed`\|`unknown`. `unknown`은 연결된 인쇄 작업을 못 찾은 경우(오래돼서 `/print/queue` 조회 범위 밖으로 밀려난 경우 등) |
| `printed` | `print_status == "done"`과 동일한 값 — 바로 쓰기 편하도록 별도 필드로도 제공 |

이 엔드포인트도 에러를 내지 않습니다.

---

### `POST /api/v1/scan/reset`

기기의 카운터 자체는 못 지우므로, 서버가 현재 값을 오프셋으로 저장 — 이후 `/status`의
`count`가 0부터 다시 세는 것처럼 보입니다 (`POST /plc/{id}/control`의 `reset_counter`와
동일한 방식).

**응답 200**
```json
{ "accepted": true, "timestamp": "2026-08-04T09:14:37.380985Z" }
```

---

## ⚠️ [DEPRECATED] 인쇄 대기열 API (구형 USB 프린터)

**클라이언트가 이 프린터를 더 이상 사용하지 않아 사용 중단됐습니다. 새 연동에는 쓰지
마세요** — 대신 아래 "PF 신형 프린터 API"를 사용하세요. 엔드포인트는 참고용으로만 남겨둠
(과거 데이터 조회 등).

스캔 이벤트로 들어온 바코드가 순서대로 쌓이는 인쇄 대기열입니다. 프린터는 네트워크가 아니라
서버에 **USB로 직접 연결**되어 시리얼 포트로 통신하며, 백그라운드 워커가 대기열을 순차
처리해 프린터로 전송합니다 (`app/services/print_worker.py`, `printer_client.py`).

### `GET /api/v1/print/queue`

**응답 200**
```json
{
  "jobs": [
    {
      "id": "a1b2c3d4",
      "barcode": "880123456789",
      "status": "done",
      "enqueued_at": "2026-08-05T09:14:26.803049Z",
      "printed_at": "2026-08-05T09:14:27.102331Z",
      "error": null
    },
    {
      "id": "e5f6a7b8",
      "barcode": "880123456790",
      "status": "failed",
      "enqueued_at": "2026-08-05T09:15:01.000000Z",
      "printed_at": null,
      "error": "failed to open printer serial port /dev/ttyUSB0: ..."
    }
  ],
  "pending_count": 0
}
```
| 필드 | 설명 |
|---|---|
| `jobs` | 최근 작업 목록, 오래된 순으로 최대 200건 |
| `jobs[].status` | `pending`(대기) \| `printing`(전송 중) \| `done`(완료) \| `failed`(실패, 자동 재시도 없음) |
| `jobs[].error` | `status=failed`일 때만 값이 있음 |
| `pending_count` | 아직 인쇄 대기 중인 작업 수 |

재시도/취소 API는 아직 없습니다 — 실패한 작업은 `failed` 상태로 계속 남습니다.

---

### `POST /api/v1/print/test`

임의 텍스트를 **큐를 거치지 않고 즉시** 프린터로 전송 — 스캔 이벤트와 무관하게 실기 연결/
프로토콜을 바로 확인하기 위한 진단용 엔드포인트입니다. `scan_history`/`print_queue`에는
기록되지 않습니다.

**요청 바디**
```json
{ "text": "TEST123" }
```
`text`는 1~200자.

**응답 200**
```json
{ "accepted": true, "text": "TEST123", "timestamp": "2026-08-09T01:35:00.000000Z" }
```

**에러**
- `422` — `text`가 비어있거나 200자 초과
- `503` — 프린터 시리얼 포트에 연결할 수 없음 (포트 경로가 잘못됐거나 장치가 꺼져있는 등)
- `502` — 연결은 됐는데 통신 중 오류 발생

---

## 경고등 API (USB Modbus-RTU)

경고등이 서버에 USB로 직접 연결되어 시리얼 포트로 통신합니다(표준 Modbus-RTU, 03H/06H/10H).
빨강/초록/노랑/파랑/흰색 5개 색상 채널 + 부저 채널을 개별 제어합니다.

각 채널 값의 의미: `mode=off`(꺼짐) / `mode=on`(상시 켜짐) / `mode=blink`(점멸, `blink_level`
1~10 — 1=0.1초 주기, 10=1초 주기).

**⚠️ 장치가 "소프트웨어 제어 모드"로 설정돼 있어야 `POST /control`이 실제로 반영됩니다** —
"IO 제어 모드(잠금)"이면 장치가 쓰기 명령을 무시하고 물리 버튼으로만 동작합니다(읽기는 항상
가능). README "경고등" 섹션 참고.

### `GET /api/v1/warning-light/status`

**응답 200**
```json
{
  "red": { "mode": "blink", "blink_level": 3 },
  "green": { "mode": "off", "blink_level": null },
  "yellow": { "mode": "on", "blink_level": null },
  "blue": { "mode": "off", "blink_level": null },
  "white": { "mode": "off", "blink_level": null },
  "buzzer": { "mode": "off", "blink_level": null },
  "battery_raw": 0,
  "timestamp": "2026-08-19T02:00:00.000000Z"
}
```
| 필드 | 설명 |
|---|---|
| `red`/`green`/`yellow`/`blue`/`white`/`buzzer` | 채널별 현재 상태. `mode`는 `off`\|`on`\|`blink`\|`unknown`(장치가 0/99/1~10 외 값을 반환한 경우) |
| `battery_raw` | 배터리 관련 레지스터 원본값 — 벤더 문서에 "备用(예비)"로만 표기되어 정확한 단위/의미가 불명확함 |

**에러**
- `503` — 경고등 시리얼 포트에 연결할 수 없음
- `502` — 연결은 됐는데 통신 중 Modbus 예외 응답 등 오류 발생

---

### `POST /api/v1/warning-light/control`

요청에 **지정한 채널만** 개별 레지스터 write로 변경합니다 — 지정하지 않은 채널은 그대로
유지됩니다.

**요청 바디**
```json
{
  "red": { "mode": "blink", "blink_level": 3 },
  "buzzer": { "mode": "off" }
}
```
`red`/`green`/`yellow`/`blue`/`white`/`buzzer` 모두 선택 필드(생략 가능). 각 채널 값:
- `{ "mode": "off" }`
- `{ "mode": "on" }`
- `{ "mode": "blink", "blink_level": 1~10 }` (`blink_level` 필수)

**응답 200**
```json
{ "accepted": true, "updated_channels": ["red", "buzzer"], "timestamp": "2026-08-19T02:00:00.000000Z" }
```

**에러**
- `422` — 채널을 하나도 지정하지 않았거나, `mode=blink`인데 `blink_level`이 없거나 1~10 범위 밖
- `503` — 경고등 시리얼 포트에 연결할 수 없음
- `502` — 연결은 됐는데 통신 중 오류 발생 (장치가 IO 제어 모드(잠금)라 쓰기가 무시되는 경우는
  에러 없이 200이 반환될 수 있음 — 장치 자체 응답은 정상이지만 실제로 반영 안 될 수 있다는 뜻)

---

## PF 신형 프린터 API (v2, 현재 사용 중인 바코드/QR 프린터)

**바코드/QR 인쇄는 이 API를 쓰세요.** 새로 구매한 프린터(PF160/PF320/PF640)용이고, 위의
구형(deprecated) Cosofteck 프린터와는 완전히 별개 하드웨어입니다. 실기 검증 완료
(2026-08-22, QR코드 전송+인쇄 확인됨).

카드 QR/티셔츠 QR처럼 값이 다른 여러 종류를 찍어야 한다면, `POST /test`를 그 값들로 각각
호출하면 됩니다 — 어떤 값을 어떤 시점에 찍을지(카드 스캔 후, 티셔츠 매칭 후 등)는
프론트엔드가 판단해서 호출 타이밍을 결정합니다.

**⚠️ 자동 스캔 흐름(MQTT)에 연결되어 있지 않습니다** — `POST /test`를 직접 호출해야
인쇄됩니다(스캔 이벤트가 자동으로 프린터를 트리거하지 않음). 이름은 `/test`지만 큐를 거치지
않고 **그 자리에서 바로** 값 전송+인쇄 트리거까지 동기적으로 처리합니다 — 응답이 오면
(`accepted: true`) 인쇄 트리거까지 끝난 것입니다(진단용으로 만들어졌지만 지금은 이게 실질
적인 인쇄 API입니다).

### `POST /api/v2/pf-printer/test`

바코드 값을 프린터로 전송(CMD 0x11)하고 인쇄를 트리거(CMD 0x21)합니다.

**요청 바디**
```json
{ "text": "9cef4a0e-b0c2-4dea-9fac-1c00c2d3e9f4-4", "pad_to_length": 38 }
```
| 필드 | 설명 |
|---|---|
| `text` | 1~200자, 바코드 바인딩 변수로 전송할 값. 실 운용 포맷은 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-N`(38자, UUID + `-`숫자 접미사) |
| `pad_to_length` | 생략 가능. 지정하면 왼쪽에 공백 패딩(문서 표기 기준 — 짧으면 왼쪽부터 채움). 생략 시 서버의 `PF_PRINTER_VAR_LENGTH` 기본값 사용 — **프린터 QR 객체에 설정된 "var length"와 정확히 일치해야 정상 출력됨(현재 배포 값 38로 확인/실기 검증됨)**. 값 길이가 이미 정확히 일치하면 생략해도 무방 |

**응답 200**
```json
{ "accepted": true, "text": "9cef4a0e-...-4", "timestamp": "2026-08-19T02:00:00.000000Z" }
```
`accepted: true`는 프린터가 값 갱신에 ACK, 인쇄 트리거에도 정상 응답(인쇄시작 0x39 또는
바로 인쇄완료 0x40 — 실기 확인 결과 이 프린터는 인쇄가 빨라서 0x39 없이 0x40으로 바로
올 수 있음, 둘 다 성공으로 처리)했다는 뜻입니다.

**에러**
- `422` — `text`가 비어있거나 200자 초과
- `503` — 프린터 시리얼 포트에 연결할 수 없음
- `409` — 프린터가 NAK(0x15)를 반환 (var length 불일치, 템플릿에 바코드 변수 바인딩 없음,
  또는 Run 모드가 아님 등)
- `502` — 연결은 됐는데 그 외 통신 오류(예상 밖의 응답 등)

---

### `GET /api/v2/pf-printer/status`

**응답 200**
```json
{ "ink_percent": 78, "buffer_count": 0, "timestamp": "2026-08-19T02:00:00.000000Z" }
```
| 필드 | 설명 |
|---|---|
| `ink_percent` | 잉크 잔량 % (0~100) |
| `buffer_count` | 프린터 버퍼에 아직 인쇄 안 된 대기 건수 (문서에 정확한 바이트 폭이 명시 안 돼있어 little-endian으로 추정 해석) |

**에러**
- `503` — 프린터 시리얼 포트에 연결할 수 없음
- `502` — 연결은 됐는데 통신 중 오류 발생

---

### `POST /api/v2/pf-printer/run`

프린터를 **Run(喷印启动) 모드**로 전환합니다. **`/test`(트리거 인쇄)는 Run 모드에서만
동작합니다** — 프린터가 Stop 상태거나 편집 화면에 들어가 있으면(터치스크린에서 템플릿을
편집하고 나오면 Run 모드가 풀림) `/test`가 `409`(NAK)를 반환하니, 그 경우 먼저 이걸
호출하세요.

**요청 바디**: 없음

**응답 200**
```json
{ "accepted": true, "running": true, "timestamp": "2026-08-22T05:29:04.384971Z" }
```

**에러**
- `503` — 프린터 시리얼 포트에 연결할 수 없음
- `409` — 프린터가 NAK를 반환
- `502` — 연결은 됐는데 그 외 통신 오류

---

### `POST /api/v2/pf-printer/stop`

프린터를 **Stop 모드**로 전환합니다. 요청/응답/에러 형식은 `/run`과 동일하고
`running: false`만 다릅니다.

---

## 기타

### `GET /healthz`

서버와 카메라/PLC/스캐너 실행 상태 헬스체크. 인증 없이 접근 가능, 모니터링/헬스체크용으로 사용.

**응답 200**
```json
{
  "status": "ok",
  "cameras": {
    "cam0": { "enabled": true, "recording": true },
    "cam1": { "enabled": false, "recording": false }
  },
  "plcs": {
    "plc0": { "monitored": true },
    "plc1": { "monitored": true }
  },
  "scan": { "connected": true }
}
```
- `plcs.{plc_id}.monitored`: 서버가 그 PLC의 가동시간 백그라운드 폴러를 실행 중인지 여부.
  PLC가 실제로 응답하는지(연결 가능 여부)는 확인하지 않습니다 — 그건 `GET /api/v1/plc/{plc_id}/status`
  호출로 확인하세요 (헬스체크 엔드포인트가 매번 모든 PLC에 Modbus 요청을 보내면 느려지고, PLC가
  꺼져있을 때 헬스체크 자체가 느려지거나 타임아웃날 수 있어 의도적으로 분리함).
- `scan.connected`: 서버가 지금 MQTT 브로커에 연결되어 있는지 (`GET /api/v1/scan/status`의
  `connected`와 동일한 값).

---

## 에러 코드 요약

| 코드 | 의미 | 주로 발생하는 곳 |
|---|---|---|
| 404 | 리소스 없음 (카메라/PLC id, 해당 시간대 녹화 없음, 라이브 꺼짐) | 대부분의 엔드포인트 |
| 409 | 충돌 (카메라/PLC id 중복) | `POST /cam`, `POST /plc` |
| 422 | 요청 파라미터 검증 실패 | 여러 곳 (쿼리/바디 값 범위 등) |
| 501 | 알 수 없는 `command` (`start`/`stop`/`reset_counter` 외) | `POST /plc/{id}/control` |
| 502 | 하위 장치(PLC)가 비정상 응답 | `/plc/*` |
| 503 | 하위 장치(PLC)에 연결 불가 | `/plc/*` |
| 500 | 서버 내부 오류 (ffmpeg 실패 등) | `/cam/{id}/seek`, `/cam/{id}/clip` |
