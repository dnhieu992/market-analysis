import type { SignalType } from '../types';

/**
 * Trend analyzer (no LLM): compares this run's snapshots with the previous run's.
 *
 *   new_entry    app appears in a top chart (country / chart / category) for the first time ever
 *                — only once there is history, otherwise the whole first run would be "new"
 *   rank_jump    climbed ≥ rank_jump_threshold places in the same chart
 *   fast_growth  rating count grew ≥ growth_threshold_pct % (previous count ≥ growth_min_rating_count)
 *   rating_drop  average rating fell ≥ rating_drop_threshold (a big app disappointing its users)
 *
 * One signal per (app, type): the strongest one is kept, the others are listed in details.
 */

export type SnapRow = {
  appId: string;
  country: string;
  chart: string;
  category: string;
  rank: number | null;
  rating: number | null;
  ratingCount: number | null;
};

export type TrendThresholds = {
  rank_jump_threshold: number;
  growth_threshold_pct: number;
  rating_drop_threshold: number;
  growth_min_rating_count: number;
};

export type TrendSignalDraft = {
  appId: string;
  signalType: SignalType;
  value: number;
  details: Record<string, unknown>;
};

const CHARTS = new Set(['top_free', 'top_paid']);
export const chartKey = (r: Pick<SnapRow, 'appId' | 'country' | 'chart' | 'category'>) => `${r.appId}|${r.country}|${r.chart}|${r.category}`;
const round = (n: number, d = 2) => Number(n.toFixed(d));

/** Best-informed row per (app, country): the one with the largest rating count (detail page > list row). */
function byAppCountry(rows: SnapRow[]): Map<string, SnapRow> {
  const out = new Map<string, SnapRow>();
  for (const r of rows) {
    if (r.rating === null && r.ratingCount === null) continue;
    const key = `${r.appId}|${r.country}`;
    const prev = out.get(key);
    if (!prev || (r.ratingCount ?? -1) > (prev.ratingCount ?? -1)) out.set(key, r);
  }
  return out;
}

export function analyzeTrends(
  current: SnapRow[],
  previous: SnapRow[],
  everCharted: ReadonlySet<string>,
  t: TrendThresholds,
): TrendSignalDraft[] {
  const strongest = new Map<string, TrendSignalDraft & { all: Record<string, unknown>[] }>();
  const add = (s: TrendSignalDraft) => {
    const key = `${s.appId}|${s.signalType}`;
    const prev = strongest.get(key);
    if (!prev) {
      strongest.set(key, { ...s, all: [s.details] });
      return;
    }
    prev.all.push(s.details);
    // new_entry: best (lowest) rank wins; the others: largest value wins.
    const better = s.signalType === 'new_entry' ? s.value < prev.value : s.value > prev.value;
    if (better) Object.assign(prev, { value: s.value, details: s.details });
  };

  const hasHistory = previous.length > 0;
  const prevCharts = new Map<string, SnapRow>();
  for (const r of previous) if (CHARTS.has(r.chart) && r.rank !== null) prevCharts.set(chartKey(r), r);

  for (const r of current) {
    if (!CHARTS.has(r.chart) || r.rank === null) continue;
    const where = { country: r.country, chart: r.chart, category: r.category || null };
    const key = chartKey(r);
    const before = prevCharts.get(key);
    if (before?.rank != null) {
      const jump = before.rank - r.rank;
      if (jump >= t.rank_jump_threshold) add({ appId: r.appId, signalType: 'rank_jump', value: jump, details: { ...where, from: before.rank, to: r.rank } });
    } else if (hasHistory && !everCharted.has(key)) {
      add({ appId: r.appId, signalType: 'new_entry', value: r.rank, details: { ...where, rank: r.rank } });
    }
  }

  const prevStats = byAppCountry(previous);
  for (const [key, r] of byAppCountry(current)) {
    const before = prevStats.get(key);
    if (!before) continue;
    const where = { country: r.country };
    if (r.ratingCount !== null && before.ratingCount !== null && before.ratingCount >= t.growth_min_rating_count) {
      const pct = ((r.ratingCount - before.ratingCount) / before.ratingCount) * 100;
      if (pct >= t.growth_threshold_pct) {
        add({ appId: r.appId, signalType: 'fast_growth', value: round(pct, 1), details: { ...where, from: before.ratingCount, to: r.ratingCount } });
      }
    }
    if (r.rating !== null && before.rating !== null) {
      const drop = before.rating - r.rating;
      if (drop >= t.rating_drop_threshold - 1e-9) {
        add({ appId: r.appId, signalType: 'rating_drop', value: round(drop), details: { ...where, from: round(before.rating), to: round(r.rating) } });
      }
    }
  }

  return [...strongest.values()].map(({ all, ...s }) => (all.length > 1 ? { ...s, details: { ...s.details, alsoIn: all.filter((d) => d !== s.details) } } : s));
}

/** Rank signals for the LLM prompt / report: big jumps and big drops first. */
export function signalStrength(s: Pick<TrendSignalDraft, 'signalType' | 'value'>): number {
  switch (s.signalType) {
    case 'rank_jump':
      return s.value; // places
    case 'fast_growth':
      return s.value / 2; // % → comparable scale
    case 'rating_drop':
      return s.value * 60;
    case 'new_entry':
      return Math.max(0, 101 - s.value) / 2; // higher entry rank = stronger
  }
}
