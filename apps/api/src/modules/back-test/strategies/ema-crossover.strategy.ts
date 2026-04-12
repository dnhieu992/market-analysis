import { calculateEma, calculateAtr } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const EMA_FAST = 9;
const EMA_SLOW = 21;
const ATR_PERIOD = 14;
const MIN_CANDLES = EMA_SLOW + ATR_PERIOD + 2;

export class EmaCrossoverStrategy implements IBackTestStrategy {
  readonly name = 'ema-crossover';
  readonly description =
    'Scalping: EMA9 crosses EMA21 → enter on crossover candle. M5 timeframe. SL = 1×ATR, TP = 1.5×ATR';
  readonly defaultTimeframe = '5m';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < MIN_CANDLES) return null;

    const closes = ctx.candles.map((c) => c.close);
    const highs = ctx.candles.map((c) => c.high);
    const lows = ctx.candles.map((c) => c.low);

    // Current EMA values
    const ema9 = calculateEma(closes, EMA_FAST);
    const ema21 = calculateEma(closes, EMA_SLOW);

    // Previous candle EMA values (detect crossover)
    const prevCloses = closes.slice(0, -1);
    const prevEma9 = calculateEma(prevCloses, EMA_FAST);
    const prevEma21 = calculateEma(prevCloses, EMA_SLOW);

    const atr = calculateAtr(highs, lows, closes, ATR_PERIOD);
    const entry = ctx.current.close;

    // ── Bullish crossover: EMA9 crosses above EMA21 ───────────────────────
    if (prevEma9 <= prevEma21 && ema9 > ema21) {
      return {
        direction: 'long',
        entryPrice: entry,
        stopLoss: entry - atr,
        takeProfit: entry + atr * 1.5
      };
    }

    // ── Bearish crossover: EMA9 crosses below EMA21 ───────────────────────
    if (prevEma9 >= prevEma21 && ema9 < ema21) {
      return {
        direction: 'short',
        entryPrice: entry,
        stopLoss: entry + atr,
        takeProfit: entry - atr * 1.5
      };
    }

    return null;
  }
}

export default EmaCrossoverStrategy;
