import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * HTTP + caching helpers shared by the collectors:
 *  - a clear User-Agent,
 *  - retry with exponential backoff (max 3 retries; 429 / 5xx / network errors), honouring Retry-After,
 *  - a per-day response cache on disk, so re-running the same day doesn't hit the sources again.
 */

export const USER_AGENT = 'app-idea-radar/0.1 (personal research bot; market-analysis)';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** YYYY-MM-DD in Vietnam time (UTC+7). */
export const vnDate = (d: Date = new Date()) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export type RetryOptions = { retries?: number; baseDelayMs?: number };

const retryable = (err: unknown) =>
  !(err instanceof HttpError) || err.status === 429 || err.status >= 500;

/** Run `fn` with up to `retries` retries and exponential backoff (base × 2^attempt, ±20% jitter). */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 2_000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !retryable(err)) throw err;
      const retryAfter = err instanceof RetryAfterError ? err.retryAfterMs : 0;
      const backoff = base * 2 ** attempt * (0.8 + Math.random() * 0.4);
      await sleep(Math.max(retryAfter, backoff));
      attempt += 1;
    }
  }
}

class RetryAfterError extends HttpError {
  constructor(
    status: number,
    url: string,
    readonly retryAfterMs: number,
  ) {
    super(status, url);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type HttpClientOptions = {
  fetchImpl?: FetchLike;
  /** Directory for the day cache; null disables caching (tests). */
  cacheDir?: string | null;
  retry?: RetryOptions;
  timeoutMs?: number;
};

export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly cacheDir: string | null;

  constructor(private readonly opts: HttpClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.cacheDir = opts.cacheDir === undefined ? join(tmpdir(), 'idea-radar-cache') : opts.cacheDir;
  }

  /** GET text with UA, retry and the day cache. `fresh` was fetched from the network (callers delay only then). */
  async getText(url: string, headers: Record<string, string> = {}): Promise<{ body: string; fresh: boolean }> {
    const cached = await this.cache.read(url);
    if (cached !== null) return { body: cached, fresh: false };

    const body = await withRetry(async () => {
      const res = await this.fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/atom+xml, */*', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
      if (!res.ok) {
        const ra = Number(res.headers.get('retry-after'));
        if (res.status === 429 && Number.isFinite(ra) && ra > 0) throw new RetryAfterError(res.status, url, Math.min(ra, 120) * 1000);
        throw new HttpError(res.status, url);
      }
      return res.text();
    }, this.opts.retry);

    await this.cache.write(url, body);
    return { body, fresh: true };
  }

  async getJson<T>(url: string): Promise<{ data: T; fresh: boolean }> {
    const { body, fresh } = await this.getText(url);
    return { data: JSON.parse(body) as T, fresh };
  }

  /** Memoize any async call (e.g. a google-play-scraper request) in the day cache under `key`. */
  async cached<T>(key: string, fn: () => Promise<T>): Promise<{ data: T; fresh: boolean }> {
    const hit = await this.cache.read(key);
    if (hit !== null) return { data: JSON.parse(hit) as T, fresh: false };
    const data = await withRetry(fn, this.opts.retry);
    await this.cache.write(key, JSON.stringify(data));
    return { data, fresh: true };
  }

  private readonly cache = {
    path: (key: string) =>
      this.cacheDir ? join(this.cacheDir, vnDate(), `${createHash('sha1').update(key).digest('hex')}.cache`) : null,
    read: async (key: string): Promise<string | null> => {
      const p = this.cache.path(key);
      if (!p) return null;
      try {
        return await readFile(p, 'utf8');
      } catch {
        return null;
      }
    },
    write: async (key: string, body: string): Promise<void> => {
      const p = this.cache.path(key);
      if (!p) return;
      try {
        await mkdir(join(p, '..'), { recursive: true });
        await writeFile(p, body, 'utf8');
      } catch {
        /* cache is best-effort */
      }
    },
  };
}
