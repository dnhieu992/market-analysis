import { calculateEma } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

/**
 * "Extended-below-EMA-stack oversold StochRSI bounce" — LONG only, counter-trend.
 *
 * Entry when a CLOSED candle satisfies ALL:
 *   1. Price below a bearish EMA stack:  close < EMA34 < EMA89 < EMA200
 *   2. Price stretched 7–15% below EMA34: distMin <= (EMA34-close)/EMA34 <= distMax
 *   3. StochRSI (14/14/3/3) bullish cross in oversold: %K (yellow) crosses above its
 *      MA %D from below, while %K < osLevel.
 *
 * Take profit tpPct above entry. Per the user's rule there is NO stop loss — the
 * position is held until the TP is hit (or marked-to-market at the end of the data).
 *
 * ⚠ Backtest note (2026-07-13, see claude-backtest/runs/): as specified (no SL) this
 * rule has ~80% TP-hit but NEGATIVE expectancy (−2.6%/trade) because rare falling-knife
 * positions are held indefinitely (avg MAE −20%). Adding an ~8% SL flips it positive.
 */

const RSI_LEN = 14;
const STOCH_LEN = 14;
const SMOOTH_K = 3;
const SMOOTH_D = 3;
const WARMUP = 200 + RSI_LEN + STOCH_LEN + SMOOTH_K + SMOOTH_D + 2;

const DEFAULT_TP_PCT = 0.1;
const DEFAULT_DIST_MIN = 0.07;
const DEFAULT_DIST_MAX = 0.15;
const DEFAULT_OS_LEVEL = 20;

function rsiSeries(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) g += d;
    else l -= d;
  }
  g /= period;
  l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) {
      g = (g * (period - 1) + d) / period;
      l = (l * (period - 1)) / period;
    } else {
      g = (g * (period - 1)) / period;
      l = (l * (period - 1) - d) / period;
    }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function sma(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    let s = 0;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      const v = values[j]!;
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      s += v;
    }
    if (ok) out[i] = s / n;
  }
  return out;
}

/** Returns the last two %K and %D values of StochRSI, or null if not enough data. */
function stochRsiTail(closes: number[]): { k: number; kPrev: number; d: number; dPrev: number } | null {
  const rsi = rsiSeries(closes, RSI_LEN);
  const raw: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    let ok = true;
    for (let j = i - STOCH_LEN + 1; j <= i; j++) {
      if (j < 0) {
        ok = false;
        break;
      }
      const v = rsi[j]!;
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (ok) raw[i] = hi === lo ? 0 : ((rsi[i]! - lo) / (hi - lo)) * 100;
  }
  const k = sma(raw, SMOOTH_K);
  const d = sma(k, SMOOTH_D);
  const n = closes.length;
  const vals = [k[n - 1], k[n - 2], d[n - 1], d[n - 2]];
  if (vals.some((v) => v === undefined || Number.isNaN(v))) return null;
  return { k: k[n - 1]!, kPrev: k[n - 2]!, d: d[n - 1]!, dPrev: d[n - 2]! };
}

function numParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export class EmaStackOversoldStochRsiStrategy implements IBackTestStrategy {
  readonly name = 'ema-stack-oversold-stochrsi';
  readonly description =
    'LONG bounce: giá dưới cụm EMA34<89<200 và giãn 7–15% dưới EMA34, StochRSI %K cắt lên %D trong vùng quá bán; TP ~10%, KHÔNG cắt lỗ (giữ tới khi chạm TP). ⚠ Backtest expectancy âm khi không có SL. Params: tpPct (0.10), distMin (0.07), distMax (0.15), osLevel (20).';
  readonly defaultTimeframe = '4h';
  readonly disableBreakeven = true;

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < WARMUP) return null;

    const closes = ctx.candles.map((c) => c.close);
    const close = ctx.current.close;
    const ema34 = calculateEma(closes, 34);
    const ema89 = calculateEma(closes, 89);
    const ema200 = calculateEma(closes, 200);

    // 1) price below a bearish EMA stack
    if (!(close < ema34 && ema34 < ema89 && ema89 < ema200)) return null;

    // 2) stretched distMin..distMax below EMA34
    const distMin = numParam(ctx.params, 'distMin', DEFAULT_DIST_MIN);
    const distMax = numParam(ctx.params, 'distMax', DEFAULT_DIST_MAX);
    const dist = (ema34 - close) / ema34;
    if (dist < distMin || dist > distMax) return null;

    // 3) StochRSI bullish cross while oversold
    const st = stochRsiTail(closes);
    if (!st) return null;
    const osLevel = numParam(ctx.params, 'osLevel', DEFAULT_OS_LEVEL);
    const crossUp = st.kPrev <= st.dPrev && st.k > st.d;
    if (!crossUp || st.k >= osLevel) return null;

    const tpPct = numParam(ctx.params, 'tpPct', DEFAULT_TP_PCT);
    return {
      direction: 'long',
      entryPrice: close,
      // No SL per the user's rule: 0 is never hit intra-candle for a long (low > 0),
      // so the trade is held until TP or end-of-data mark-to-market.
      stopLoss: 0,
      takeProfit: close * (1 + tpPct),
    };
  }
}

export default EmaStackOversoldStochRsiStrategy;
