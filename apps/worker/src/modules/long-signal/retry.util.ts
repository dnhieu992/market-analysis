import type { Logger } from '@nestjs/common';

export type RetryOptions = {
  label: string;
  retries?: number;
  baseDelayMs?: number;
  logger?: Logger;
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run `fn`, retrying with exponential backoff. Only wrap idempotent/read ops. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { label, retries = 3, baseDelayMs = 500, logger, isRetryable = () => true, sleep = defaultSleep } = opts;
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
