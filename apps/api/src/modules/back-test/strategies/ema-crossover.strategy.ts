import { calculateEma, calculateAtr } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

export class EmaCrossoverStrategy implements IBackTestStrategy {
  readonly name = 'ema-crossover';
  readonly description = 'Enter long when EMA20 crosses above EMA50, short when it crosses below';
  readonly defaultTimeframe = '4h';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < 52) return null;

    const closes = ctx.candles.map((c) => c.close);
    const prevCloses = closes.slice(0, -1);

    const ema20Now = calculateEma(closes, 20);
    const ema50Now = calculateEma(closes, 50);
    const ema20Prev = calculateEma(prevCloses, 20);
    const ema50Prev = calculateEma(prevCloses, 50);

    const highs = ctx.candles.map((c) => c.high);
    const lows = ctx.candles.map((c) => c.low);
    const atr = calculateAtr(highs, lows, closes, 14);

    const entry = ctx.current.close;

    if (ema20Prev <= ema50Prev && ema20Now > ema50Now) {
      return {
        direction: 'long',
        entryPrice: entry,
        stopLoss: entry - 2 * atr,
        takeProfit: entry + 3 * atr
      };
    }

    if (ema20Prev >= ema50Prev && ema20Now < ema50Now) {
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
