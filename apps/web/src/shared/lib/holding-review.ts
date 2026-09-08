import type { HoldingReview } from '@web/shared/api/types';

/**
 * Presentation for a daily-review verdict. The verdicts and their colours come
 * from claude-cron/portfolio-review/prompt.md — the Telegram report and the
 * portfolio pages must read as the same thing, so the emoji match it exactly.
 *
 * Four of them judge an open position; MUA LẠI / CHỜ VÙNG belong to the buy-back
 * (snowball) list and only ever land on a row that is already fully sold.
 */
export type VerdictStyle = {
  emoji: string;
  /** Badge text and border colour. */
  color: string;
  /** Badge fill — the same hue at low alpha, readable in both themes. */
  background: string;
};

const STYLES: Record<string, VerdictStyle> = {
  'GOM THÊM': { emoji: '🟢', color: '#22c55e', background: 'rgba(34,197,94,0.12)' },
  'GIỮ':      { emoji: '🔵', color: '#3b82f6', background: 'rgba(59,130,246,0.12)' },
  'CHỐT BỚT': { emoji: '🟠', color: '#f59e0b', background: 'rgba(245,158,11,0.12)' },
  'THOÁT':    { emoji: '🔴', color: '#ef4444', background: 'rgba(239,68,68,0.12)' },
  'MUA LẠI':  { emoji: '🟢', color: '#22c55e', background: 'rgba(34,197,94,0.12)' },
  'CHỜ VÙNG': { emoji: '🟡', color: '#eab308', background: 'rgba(234,179,8,0.12)' },
};

const UNKNOWN: VerdictStyle = { emoji: '⚪', color: 'var(--muted)', background: 'rgba(128,128,128,0.12)' };

/** Unknown verdicts render grey rather than breaking the row. */
export function verdictStyle(verdict: string): VerdictStyle {
  return STYLES[verdict.trim().toUpperCase()] ?? STYLES[verdict.trim()] ?? UNKNOWN;
}

const BUY_BACK_VERDICTS = new Set(['MUA LẠI', 'CHỜ VÙNG']);

/**
 * True only for the snowball buy-back verdicts — the two that can land on a
 * sold-out coin. A coin's newest review can otherwise be a stale open-position
 * verdict (GIỮ, THOÁT, …) left over from before it was fully sold, which is not
 * a reason to keep that row looking active.
 */
export function isBuyBackVerdict(verdict: string): boolean {
  return BUY_BACK_VERDICTS.has(verdict.trim().toUpperCase());
}

/** `2026-09-06` → `06/09` — the badge only has room for day and month. */
export function shortReviewDate(reviewDate: string): string {
  const [, month, day] = reviewDate.split('-');
  return month && day ? `${day}/${month}` : reviewDate;
}

/**
 * How stale a review is, in whole days. The cron runs at 00:00 UTC, so anything
 * older than a day means the job did not run — worth showing rather than hiding
 * behind a confident-looking badge.
 */
export function reviewAgeDays(reviewDate: string, now = new Date()): number {
  const then = Date.parse(`${reviewDate}T00:00:00.000Z`);
  if (Number.isNaN(then)) return 0;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

/** Newest review per coin, keyed by coinId — what the Holdings table looks up. */
export function reviewsByCoin(reviews: HoldingReview[]): Record<string, HoldingReview> {
  const out: Record<string, HoldingReview> = {};
  for (const review of reviews) {
    const existing = out[review.coinId];
    if (!existing || review.reviewDate > existing.reviewDate) out[review.coinId] = review;
  }
  return out;
}
