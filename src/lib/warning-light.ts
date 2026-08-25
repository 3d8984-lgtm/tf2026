/**
 * 1번 경고등(USB Modbus-RTU) 제어 도우미.
 * POST /api/v1/warning-light/control 로 채널별 on/off 를 전송한다.
 */
const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function control(body: Record<string, unknown>) {
  try {
    await fetch(`${PROXY_BASE}/api/v1/warning-light/control`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* 경고등 장치 오류는 스캔 흐름을 막지 않는다 */
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

/** 2번 경고등(USB_D3V1) 제어 — /api/v2/d3v1-light/control */
async function control2(body: Record<string, unknown>) {
  try {
    await fetch(`${PROXY_BASE}/api/v2/d3v1-light/control`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* 경고등 장치 오류는 스캔 흐름을 막지 않는다 */
  }
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
