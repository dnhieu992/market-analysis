import { calculateEma } from '../indicators/ema';
import { calculateRsi } from '../indicators/rsi';
import { calculateStochRsi } from '../indicators/stoch-rsi';

/**
 * "Extended-below-EMA-stack oversold StochRSI bounce" entry detector (LONG only).
 *
 * Evaluated on the LAST candle of `closes`. Fires when ALL hold:
 *   1. Price below a bearish EMA stack:  close < EMA34 < EMA89 < EMA200
 *   2. Price stretched distMin..distMax below EMA34: (EMA34-close)/EMA34 ∈ [distMin, distMax]
 *   3. StochRSI (14/14/3/3) bullish cross in oversold: %K crosses above %D from below,
 *      while %K < osLevel.
 *
 * Shared by the /strategy-test backtest strategy and the worker's 4h auto-scanner so
 * both use identical maths.
 */
export type EmaStackOversoldConfig = {
  tpPct: number;      // take-profit fraction, e.g. 0.10
  distMin: number;    // min distance below EMA34, e.g. 0.07
  distMax: number;    // max distance below EMA34, e.g. 0.15
  osLevel: number;    // StochRSI oversold threshold, e.g. 20
};

export const DEFAULT_EMA_STACK_OVERSOLD_CONFIG: EmaStackOversoldConfig = {
  tpPct: 0.1,
  distMin: 0.07,
  distMax: 0.15,
  osLevel: 20,
};

/** Minimum candles needed before a signal can be evaluated (EMA200 + StochRSI warm-up). */
export const EMA_STACK_OVERSOLD_MIN_CANDLES = 200 + 14 + 14 + 3 + 3 + 2;

export type EmaStackOversoldEntry = {
  price: number;
  ema34: number;
  ema89: number;
  ema200: number;
  /** Distance below EMA34 as a fraction, e.g. 0.093 = 9.3% below. */
  distPct: number;
  rsi: number;
  stochK: number;
  stochD: number;
  /** Take-profit price = price × (1 + tpPct). */
  tpPrice: number;
};

/**
 * Returns the entry snapshot when the last candle satisfies the rule, else null.
 */
export function detectEmaStackOversoldEntry(
  closes: number[],
  config: Partial<EmaStackOversoldConfig> = {},
): EmaStackOversoldEntry | null {
  const cfg = { ...DEFAULT_EMA_STACK_OVERSOLD_CONFIG, ...config };
  if (closes.length < EMA_STACK_OVERSOLD_MIN_CANDLES) return null;

  const price = closes[closes.length - 1]!;
  const ema34 = calculateEma(closes, 34);
  const ema89 = calculateEma(closes, 89);
  const ema200 = calculateEma(closes, 200);

  // 1) price below a bearish EMA stack
  if (!(price < ema34 && ema34 < ema89 && ema89 < ema200)) return null;

  // 2) stretched distMin..distMax below EMA34
  const distPct = (ema34 - price) / ema34;
  if (distPct < cfg.distMin || distPct > cfg.distMax) return null;

  // 3) StochRSI bullish cross while oversold
  const { k, d } = calculateStochRsi(closes);
  const n = closes.length;
  const kNow = k[n - 1];
  const kPrev = k[n - 2];
  const dNow = d[n - 1];
  const dPrev = d[n - 2];
  if (
    kNow === undefined || kPrev === undefined || dNow === undefined || dPrev === undefined ||
    Number.isNaN(kNow) || Number.isNaN(kPrev) || Number.isNaN(dNow) || Number.isNaN(dPrev)
  ) {
    return null;
  }
  const crossUp = kPrev <= dPrev && kNow > dNow;
  if (!crossUp || kNow >= cfg.osLevel) return null;

  return {
    price,
    ema34,
    ema89,
    ema200,
    distPct,
    rsi: calculateRsi(closes, 14),
    stochK: kNow,
    stochD: dNow,
    tpPrice: price * (1 + cfg.tpPct),
  };
}
