import { LOGIN_LOCK_MS, MAX_LOGIN_FAILURES } from './auth.constants';

/**
 * In-memory failure counter for login steps, keyed by `ip:<addr>` and
 * `email:<addr>`. A key locks once it has MAX_LOGIN_FAILURES failures inside
 * the last LOGIN_LOCK_MS. One API process, so memory is enough — a restart
 * simply forgets the counters.
 */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = MAX_LOGIN_FAILURES,
    private readonly windowMs = LOGIN_LOCK_MS
  ) {}

  /** Ms until the key unlocks, or 0 when it is not locked. */
  lockedFor(key: string, nowMs: number): number {
    const recent = this.recent(key, nowMs);
    if (recent.length < this.maxFailures) return 0;
    return recent[recent.length - this.maxFailures]! + this.windowMs - nowMs;
  }

  /** Records a failure; returns true when this failure is the one that locks the key. */
  fail(key: string, nowMs: number): boolean {
    const recent = this.recent(key, nowMs);
    recent.push(nowMs);
    this.failures.set(key, recent);
    return recent.length === this.maxFailures;
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string, nowMs: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (kept.length === 0) this.failures.delete(key);
    return kept;
  }
}
