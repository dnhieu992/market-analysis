import type { Logger } from '@nestjs/common';

export type RetryOptions = {
  /** A short label for logs, e.g. "fetchCandles" or "close signal abc". */
  label: string;
  /** Total attempts, including the first. Default 3. */
  retries?: number;
  /** Base delay for the first backoff step in ms. Default 500 (→ 500, 1000, 2000…). */
  baseDelayMs?: number;
  /** Optional logger — warns on each failed attempt. */
  logger?: Logger;
  /**
   * Decide whether an error is worth retrying. Default: always retry.
   * Return false for permanent failures (bad input, 4xx) so we fail fast.
   */
  isRetryable?: (err: unknown) => boolean;
  /** Injectable sleep — overridable in tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying up to `retries` times with exponential backoff.
 *
 * Used for the trading bot's critical I/O (market-data fetch, DB result writes,
 * and — in LIVE mode — order place/close). A transient network/DB hiccup should
 * not silently drop a scan or leave a signal un-closed.
 *
 * IMPORTANT: only wrap operations that are safe to repeat. Placing/closing a
 * REAL order is NOT idempotent on its own — pass a stable `clientOrderId` to the
 * broker first (see docs: idempotency, REQUIRED before live) before retrying it.
 *
 * Throws the last error if every attempt fails, so the caller still decides how
 * to degrade (return [] / null / re-arm the cache).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const {
    label,
    retries = 3,
    baseDelayMs = 500,
    logger,
    isRetryable = () => true,
    sleep = defaultSleep,
  } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === retries || !isRetryable(err)) {
        logger?.warn(`${label} failed permanently after ${attempt} attempt(s): ${msg}`);
        break;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger?.warn(`${label} failed (attempt ${attempt}/${retries}): ${msg}. Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}
