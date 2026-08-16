/**
 * 로컬 프린트 에이전트 클라이언트.
 *
 * 캐리어(4PX)가 발급한 원본 PDF를 브라우저 인쇄 경로 대신 작업 PC의 에이전트로 보내
 * 프린터에 직접 전달합니다. 실패하면 호출부가 기존 브라우저 인쇄로 폴백합니다.
 */
export interface PrintAgentConfig {
  enabled: boolean;
  url: string;       // http://localhost:17777
  token: string;
  printer: string;   // Windows 프린터 이름
}

export const DEFAULT_PRINT_AGENT: PrintAgentConfig = {
  enabled: false,
  url: "http://localhost:17777",
  token: "",
  printer: "",
};

export const PRINT_AGENT_SETTING_KEY = "shipping.print_agent";

const base = (cfg: PrintAgentConfig) => cfg.url.replace(/\/+$/, "");

export async function agentHealth(cfg: PrintAgentConfig, timeoutMs = 4000) {
  const res = await fetch(`${base(cfg)}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as {
    ok: boolean; sumatra: string | null; default_printer: string;
    printers: string[]; token_required: boolean; platform: string;
  };
}

export interface AgentPrintResult {
  ok: boolean;
  job_id?: string;
  printer?: string;
  ms?: number;
  bytes?: number;
  error?: string;
}

/** 라벨(PDF/이미지) URL을 에이전트로 보내 즉시 인쇄합니다. */
export async function agentPrint(
  cfg: PrintAgentConfig,
  input: { url?: string; base64?: string; jobId?: string; copies?: number },
  timeoutMs = 15_000,
): Promise<AgentPrintResult> {
  try {
    const res = await fetch(`${base(cfg)}/print`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.token ? { "x-agent-token": cfg.token } : {}),
      },
      body: JSON.stringify({
        url: input.url,
        base64: input.base64,
        job_id: input.jobId,
        copies: input.copies ?? 1,
        printer: cfg.printer || undefined,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as AgentPrintResult;
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const isAgentReady = (cfg: PrintAgentConfig) =>
  Boolean(cfg.enabled && cfg.url && cfg.printer);
