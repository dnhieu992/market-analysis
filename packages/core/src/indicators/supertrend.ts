// packages/core/src/indicators/supertrend.ts
import type { Candle } from '../types/candle';

/**
 * Supertrend (ATR period 10, multiplier 3 by default) — the classic
 * KivancOzbilgic/TradingView formulation:
 *
 *   atr  = rma(trueRange, period)
 *   up   = hl2 − mult × atr   (support line, drawn while trend is up)
 *   dn   = hl2 + mult × atr   (resistance line, drawn while trend is down)
 *   up  := close[1] > up[1] ? max(up, up[1]) : up     // ratchets up, never down
 *   dn  := close[1] < dn[1] ? min(dn, dn[1]) : dn     // ratchets down, never up
 *   dir := dir[1] == 'down' && close > dn[1] ? 'up'
 *        : dir[1] == 'up'   && close < up[1] ? 'down'
 *        : dir[1]
 *
 * Returned arrays are aligned 1:1 with `candles`; entries before the ATR is warm
 * (index < period − 1) are `null`.
 */
export type SupertrendDirection = 'up' | 'down';

export type SupertrendSeries = {
  /** Active line: the `up` band while the trend is up, the `dn` band while it is down. */
  line: (number | null)[];
  direction: (SupertrendDirection | null)[];
};

/** Wilder's RMA-smoothed ATR, aligned to `candles` (0 before warm-up). */
function calcRmaAtr(candles: Candle[], period: number): number[] {
  const atr: number[] = new Array(candles.length).fill(0);
  if (candles.length < period) return atr;

  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1]!;
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  }
  return atr;
}

export function calculateSupertrend(
  candles: Candle[],
  period = 10,
  multiplier = 3,
): SupertrendSeries {
  const line: (number | null)[] = new Array(candles.length).fill(null);
  const direction: (SupertrendDirection | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return { line, direction };

  const atr = calcRmaAtr(candles, period);
  let prevUp = NaN;
  let prevDn = NaN;
  let prevDir: SupertrendDirection = 'up';

  for (let i = period - 1; i < candles.length; i++) {
    const c = candles[i]!;
    const hl2 = (c.high + c.low) / 2;
    const basicUp = hl2 - multiplier * atr[i]!;
    const basicDn = hl2 + multiplier * atr[i]!;
    const prevClose = i > 0 ? candles[i - 1]!.close : c.close;

    const up = Number.isNaN(prevUp) ? basicUp : prevClose > prevUp ? Math.max(basicUp, prevUp) : basicUp;
    const dn = Number.isNaN(prevDn) ? basicDn : prevClose < prevDn ? Math.min(basicDn, prevDn) : basicDn;

    // First warm bar has no previous direction to carry — seed it from the close.
    const dir: SupertrendDirection = Number.isNaN(prevUp)
      ? (c.close >= up ? 'up' : 'down')
      : prevDir === 'down' && c.close > prevDn
        ? 'up'
        : prevDir === 'up' && c.close < prevUp
          ? 'down'
          : prevDir;

    line[i] = dir === 'up' ? up : dn;
    direction[i] = dir;

    prevUp = up;
    prevDn = dn;
    prevDir = dir;
  }

  return { line, direction };
}

export type SupertrendState = {
  direction: SupertrendDirection;
  /** Active Supertrend line level on the last candle. */
  line: number;
  /** Candles since the last flip — 0 means the last candle IS the flip bar. */
  barsSince: number | null;
  /** The last candle is the flip bar (a brand-new signal). */
  freshFlip: boolean;
};

/**
 * Supertrend reading on the LAST candle of `candles`. Pass only closed candles —
 * a forming candle repaints the direction. Returns null before the ATR is warm.
 */
export function calcSupertrendState(
  candles: Candle[],
  period = 10,
  multiplier = 3,
): SupertrendState | null {
  const { line, direction } = calculateSupertrend(candles, period, multiplier);
  const last = candles.length - 1;
  const dir = direction[last];
  const level = line[last];
  if (!dir || level == null) return null;

  let barsSince: number | null = null;
  for (let i = last; i > 0; i--) {
    const prev = direction[i - 1];
    if (prev == null) break;
    if (direction[i] !== prev) {
      barsSince = last - i;
      break;
    }
  }

  return { direction: dir, line: level, barsSince, freshFlip: barsSince === 0 };
}
