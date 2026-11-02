/**
 * SSR caps the exchange positions call so one slow exchange can't hold the whole
 * page — the API retries MEXC reads for up to ~30s. On timeout/failure the
 * fallback is marked `unavailable` (NOT `configured: false`) and the client
 * widget refetches on mount.
 */
export const SSR_POSITIONS_TIMEOUT_MS = 10_000;

export function withSsrFallback<T>(promise: Promise<T>, fallback: T, timeoutMs = SSR_POSITIONS_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}
