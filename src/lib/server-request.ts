/**
 * 서버 요청 타임아웃 + 자동 재시도 유틸.
 * Lovable Cloud 백엔드가 일시적으로 응답하지 않을 때(콜드스타트, 일시 장애)
 * 사용자가 원인을 알 수 있고 자동으로 재시도되도록 한다.
 */

export class ServerUnreachableError extends Error {
  constructor(message = "서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.") {
    super(message);
    this.name = "ServerUnreachableError";
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2; // 최초 시도 포함 총 3회
const RETRY_DELAY_MS = 2_000;

function isNetworkishError(err: unknown): boolean {
  if (!err) return true;
  const msg = (err as Error)?.message ?? "";
  return /failed to fetch|network|timeout|fetchfailed|502|503|504/i.test(msg);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * promise를 timeout 내에 완료하지 못하거나 네트워크 오류가 나면
 * 자동으로 재시도한다. 모든 재시도가 실패하면 ServerUnreachableError를 던진다.
 */
export async function withServerRetry<T>(
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; retries?: number; onRetry?: (attempt: number) => void },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts?.retries ?? DEFAULT_RETRIES;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new ServerUnreachableError()), timeoutMs),
        ),
      ]);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ServerUnreachableError || isNetworkishError(err);
      if (!retryable || attempt >= retries) {
        if (err instanceof ServerUnreachableError) throw err;
        if (!retryable) throw err;
        throw new ServerUnreachableError();
      }
      opts?.onRetry?.(attempt + 1);
      await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new ServerUnreachableError();
}

export function isServerUnreachable(err: unknown): boolean {
  return err instanceof ServerUnreachableError;
}
