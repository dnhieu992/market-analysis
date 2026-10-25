/**
 * PDH/PDL breakout rules (1h) — pure logic shared by StrategyPaperTradesService and
 * scripts/run-paper-strategies-backtest.ts.
 */

type Bar = { t: number; open: number; high: number; low: number; close: number };

const utcDayIndex = (ms: number) => Math.floor(ms / 864e5);

/**
 * Skip a breakout whose stop (the far side of yesterday's range) is more than this % from the
 * entry (2026-10-25 review): such wide-range days almost never reach 2R before the EOD close.
 * Backtest 2024-01 → 2026-10, BTC+ETH+SOL: +21.0R → +49.4R, maxDD −20.5R → −15.0R.
 */
export const PDHL_MAX_RISK_PCT = 3.5;

/** Wilder ATR14 (NaN until seeded). */
export function atr14(c: Bar[]): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  const tr = new Array<number>(c.length).fill(0);
  for (let i = 1; i < c.length; i += 1) {
    const cur = c[i]!;
    const prev = c[i - 1]!;
    tr[i] = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
  }
  const p = 14;
  if (c.length <= p) return out;
  let a = tr.slice(1, p + 1).reduce((x, y) => x + y, 0) / p;
  out[p] = a;
  for (let i = p + 1; i < c.length; i += 1) { a = (a * (p - 1) + tr[i]!) / p; out[i] = a; }
  return out;
}

/** Previous UTC day's high/low relative to a given day index, from the candles. */
export function prevDayLevels(closed: Bar[], dayIdx: number): { pdh: number; pdl: number } | null {
  let hi = -Infinity, lo = Infinity, found = false;
  for (const c of closed) {
    if (utcDayIndex(c.t) === dayIdx - 1) { found = true; if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; }
  }
  return found ? { pdh: hi, pdl: lo } : null;
}

/**
 * Does the LAST candle of `closed` (1h, oldest first, ≥ 1 day of history) break yesterday's
 * range? Stop = opposite side of yesterday's range ± 0.1 ATR. No entry in the last hour of the day.
 * `minBreakPct` = how far beyond the level the close must be (0 = any close beyond it).
 * `maxRiskPct` = skip when the stop is further than this % from the entry (the signal close).
 */
export function pdhlSignal(
  closed: Bar[],
  minBreakPct = 0,
  maxRiskPct = PDHL_MAX_RISK_PCT,
): { direction: 'LONG' | 'SHORT'; stop: number; pdh: number; pdl: number } | null {
  const i = closed.length - 1;
  const sig = closed[i];
  if (!sig) return null;
  const hourOfDay = Math.floor((sig.t % 864e5) / 36e5);
  if (hourOfDay >= 23) return null;
  const lv = prevDayLevels(closed, utcDayIndex(sig.t));
  if (!lv) return null;
  const atrHere = atr14(closed)[i];
  const a = atrHere != null && Number.isFinite(atrHere) ? atrHere : sig.close * 0.003;
  const k = minBreakPct / 100;
  const tooWide = (stop: number) => (Math.abs(sig.close - stop) / sig.close) * 100 > maxRiskPct;
  if (sig.close > lv.pdh * (1 + k)) {
    const stop = Math.min(sig.low, lv.pdl) - 0.1 * a;
    return tooWide(stop) ? null : { direction: 'LONG', stop, ...lv };
  }
  if (sig.close < lv.pdl * (1 - k)) {
    const stop = Math.max(sig.high, lv.pdh) + 0.1 * a;
    return tooWide(stop) ? null : { direction: 'SHORT', stop, ...lv };
  }
  return null;
}
