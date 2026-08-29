/**
 * 경고등 제어 도우미.
 *
 * 백엔드 API 개정(2026-08) 이후 공식 경고등 API 는 3색+부저 USB 다층 경고등
 * `POST /api/v1/d3v1-light/control` 하나다 (mode: off | on | blink, 점멸 속도 조절 없음).
 * 구형 1번 경고등(`/api/v1/warning-light/*`)은 문서에서 제외되었으므로, 호출이
 * 404/405 로 떨어지면 자동으로 d3v1 경고등으로 폴백한다.
 */
const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function post(path: string, body: Record<string, unknown>): Promise<Response | null> {
  try {
    return await fetch(`${PROXY_BASE}${path}`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null; // 경고등 장치 오류는 스캔 흐름을 막지 않는다
  }
}

/** 1번 경고등(구형 Modbus-RTU). 엔드포인트가 사라졌으면 2번 경고등으로 폴백. */
async function control(body: Record<string, unknown>) {
  const res = await post("/api/v1/warning-light/control", body);
  if (!res || res.status === 404 || res.status === 405 || res.status === 501) {
    await control2(body);
  }
}

/** 검수 통과: 녹색등을 0.5초간 점등 후 자동 소등 */
export async function warnLightOkFlash() {
  await control({ green: { mode: "on" } });
  setTimeout(() => void control({ green: { mode: "off" } }), 500);
}

/** 검수 실패: 빨강등 점등 (수동으로 끄기 전까지 유지) */
export async function warnLightError() {
  await control({ green: { mode: "off" } });
  await control({ red: { mode: "on" } });
}

/** 빨강등 수동 소등 */
export async function warnLightClear() {
  await control({ red: { mode: "off" } });
}

/** 2번 경고등(USB_D3V1) 제어 — POST /api/v1/d3v1-light/control */
async function control2(body: Record<string, unknown>) {
  await post("/api/v1/d3v1-light/control", body);
}

/** 2번 경고등 검수 통과: 녹색등 0.5초 점등 후 소등 */
export async function warnLight2OkFlash() {
  await control2({ green: { mode: "on" } });
  setTimeout(() => void control2({ green: { mode: "off" } }), 500);
}

/** 2번 경고등 녹색 소등 */
export async function warnLight2Off() {
  await control2({ green: { mode: "off" } });
}
