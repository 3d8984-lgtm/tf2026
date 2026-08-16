# TWINMETA 송장 프린트 에이전트 (Windows)

4PX가 발급한 **원본 PDF 송장을 브라우저를 거치지 않고** 로컬 라벨 프린터(APT04-A 등)로
직접 보냅니다. 크롬 인쇄 경로에서 발생하던 화질 저하(글자 끊김·바코드 뭉개짐)와
인쇄 팝업/수동 확인이 사라집니다.

## 1. 설치 (송장 프린터가 연결된 작업용 PC)

1. **Node.js 18 이상** 설치 — https://nodejs.org (LTS)
2. **SumatraPDF** 설치 또는 portable 실행파일 다운로드 — https://www.sumatrapdfreader.org/
   (portable `SumatraPDF.exe`는 이 폴더에 그대로 두면 자동 인식됩니다)
3. 이 `print-agent` 폴더를 PC에 복사 (예: `C:\twinmeta\print-agent`)
4. `.env.example`을 `.env`로 복사하고 값 입력

```
AGENT_PORT=17777
AGENT_TOKEN=사내에서-정한-임의-문자열
DEFAULT_PRINTER=APT04-A
SUMATRA_PATH=C:/Program Files/SumatraPDF/SumatraPDF.exe
```

`DEFAULT_PRINTER`는 Windows "장치 및 프린터"에 표시되는 이름과 **정확히 동일**해야 합니다.

5. 실행

```
cd C:\twinmeta\print-agent
node server.mjs
```

`http://localhost:17777/health` 를 브라우저에서 열어 `printers` 목록에 송장 프린터가
보이면 정상입니다.

## 2. 항상 켜지게 하기 (Windows 서비스)

```
npm i -g pm2 pm2-windows-startup
pm2 start server.mjs --name twinmeta-print-agent
pm2 save
pm2-startup install
```

## 3. 앱 연결

시스템 설정 → 택배사 연동 설정 → **송장 프린트 에이전트** 섹션에서
에이전트 주소(`http://localhost:17777`), 토큰, 프린터 이름을 입력하고
[연결 테스트] 후 [에이전트로 인쇄] 스위치를 켜면 됩니다.
설정은 서버에 저장되어 모든 PC/계정에 공유됩니다.

에이전트가 꺼져 있거나 인쇄에 실패하면 **자동으로 기존 브라우저 인쇄로 폴백**하므로
작업이 중단되지 않습니다.

## 4. 프린터 드라이버 권장 설정

- 용지: 100 x 150 mm (4x6")
- 배율: 100% / 실제 크기 (에이전트가 `noscale`로 보냅니다)
- 농도(Darkness): 중간 이상, 속도는 2~3 ips 권장
- 세로 흰 줄이 계속 보이면 프린트헤드를 알코올로 청소하세요 (헤드 오염 증상)

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 상태, SumatraPDF 경로, 프린터 목록 (토큰 불필요) |
| GET | `/printers` | 프린터 목록 |
| POST | `/print` | `{ url \| base64, printer?, copies?, job_id? }` 로 즉시 인쇄 |

인증: 헤더 `x-agent-token: <AGENT_TOKEN>`
