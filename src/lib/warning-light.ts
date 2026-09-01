/**
 * 경고등 제어 도우미.
 *
 * 공식 경고등 API는 3색+부저 USB 다층 경고등 `POST /api/v1/d3v1-light/control` 하나다
 * (mode: off | on | blink, 점멸 속도 조절 없음, 파랑/흰색 없음).
 *
 * 서버 개정(2026-09)으로 지연이 개선되었다:
 * - 지정한 채널만 변경되고 나머지는 유지된다(서버가 read-modify-write).
 * - 여러 채널을 한 요청에 묶어 보낼 수 있으므로, 이전처럼 채널별로 연속 호출할 필요가 없다
 *   (요청 수가 절반으로 줄어 체감 딜레이가 크게 개선됨).
 */
const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type ChannelMode = { mode: "off" | "on" | "blink" };
type ControlBody = Partial<Record<"red" | "yellow" | "green" | "buzzer", ChannelMode>>;

async function post(path: string, body: ControlBody): Promise<Response | null> {
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

/** 경고등 제어 — POST /api/v1/d3v1-light/control (지정 채널만 변경, 단일 요청). */
async function control(body: ControlBody) {
  await post("/api/v1/d3v1-light/control", body);
}

/** 검수 통과: 녹색등을 0.5초간 점등 후 자동 소등 (서버 딜레이 개선으로 다시 사용) */
export async function warnLightOkFlash() {
  await control({ green: { mode: "on" } });
  setTimeout(() => void control({ green: { mode: "off" } }), 500);
}

/** 검수 실패: 녹색 소등 + 빨강 점등을 한 요청으로 처리 (수동으로 끄기 전까지 유지) */
export async function warnLightError() {
  await control({ green: { mode: "off" }, red: { mode: "on" } });
}

/** 빨강등 수동 소등 */
export async function warnLightClear() {
  await control({ red: { mode: "off" } });
}

/** 녹색 소등 */
export async function warnLight2Off() {
  await control({ green: { mode: "off" } });
}
