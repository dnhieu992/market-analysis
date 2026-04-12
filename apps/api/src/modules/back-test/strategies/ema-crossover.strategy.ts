import { calculateEma, calculateAtr } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

// How many candles back to look for a recent EMA20/50 crossover
const CROSSOVER_LOOKBACK = 20;

/**
 * Check whether EMA20 crossed above/below EMA50 within the last `lookback` candles.
 * Returns 'bullish' | 'bearish' | null.
 */
function recentCrossover(closes: number[], lookback: number): 'bullish' | 'bearish' | null {
  for (let offset = 1; offset <= lookback; offset++) {
    const slice = closes.slice(0, closes.length - offset);
    const prevSlice = closes.slice(0, closes.length - offset - 1);
    if (prevSlice.length < 52) break;

    const ema20Now = calculateEma(slice, 20);
    const ema50Now = calculateEma(slice, 50);
    const ema20Prev = calculateEma(prevSlice, 20);
    const ema50Prev = calculateEma(prevSlice, 50);

    if (ema20Prev <= ema50Prev && ema20Now > ema50Now) return 'bullish';
    if (ema20Prev >= ema50Prev && ema20Now < ema50Now) return 'bearish';
  }
  return null;
}

export class EmaCrossoverStrategy implements IBackTestStrategy {
  readonly name = 'ema-crossover';
  readonly description =
    'Enter long/short on a re-test of EMA20 after EMA20/50 crossover (within last 20 candles). SL = 2×ATR, TP = 3×ATR';
  readonly defaultTimeframe = '4h';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < 52 + CROSSOVER_LOOKBACK + 1) return null;

    const closes = ctx.candles.map((c) => c.close);
    const highs = ctx.candles.map((c) => c.high);
    const lows = ctx.candles.map((c) => c.low);

    const ema20 = calculateEma(closes, 20);
    const ema50 = calculateEma(closes, 50);
    const atr = calculateAtr(highs, lows, closes, 14);

    const current = ctx.current;
    const entry = current.close;

    const crossover = recentCrossover(closes, CROSSOVER_LOOKBACK);

    // ── Long re-test ──────────────────────────────────────────────────────────
    // Crossover was bullish, EMA20 still above EMA50, candle low touched EMA20
    // but closed above it (bounce confirmation)
    if (
      crossover === 'bullish' &&
      ema20 > ema50 &&
      current.low <= ema20 &&
      current.close > ema20
    ) {
      return {
        direction: 'long',
        entryPrice: entry,
        stopLoss: entry - 2 * atr,
        takeProfit: entry + 3 * atr
      };
    }

    // ── Short re-test ─────────────────────────────────────────────────────────
    // Crossover was bearish, EMA20 still below EMA50, candle high touched EMA20
    // but closed below it (rejection confirmation)
    if (
      crossover === 'bearish' &&
      ema20 < ema50 &&
      current.high >= ema20 &&
      current.close < ema20
    ) {
      return {
        direction: 'short',
        entryPrice: entry,
        stopLoss: entry + 2 * atr,
        takeProfit: entry - 3 * atr
      };
    }

    return null;
  }
}

export default EmaCrossoverStrategy;
