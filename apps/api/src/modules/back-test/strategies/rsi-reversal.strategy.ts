import { calculateRsi, calculateAtr } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const RSI_PERIOD = 14;
const OVERSOLD = 30;
const OVERBOUGHT = 70;

export class RsiReversalStrategy implements IBackTestStrategy {
  readonly name = 'rsi-reversal';
  readonly description =
    'Enter long when RSI crosses above oversold (30), short when it crosses below overbought (70)';
  readonly defaultTimeframe = '4h';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < RSI_PERIOD + 2) return null;

    const closes = ctx.candles.map((c) => c.close);
    const prevCloses = closes.slice(0, -1);

    const rsiNow = calculateRsi(closes, RSI_PERIOD);
    const rsiPrev = calculateRsi(prevCloses, RSI_PERIOD);

    const highs = ctx.candles.map((c) => c.high);
    const lows = ctx.candles.map((c) => c.low);
    const atr = calculateAtr(highs, lows, closes, RSI_PERIOD);

    const entry = ctx.current.close;

    // RSI crosses above oversold — long entry
    if (rsiPrev <= OVERSOLD && rsiNow > OVERSOLD) {
      return {
        direction: 'long',
        entryPrice: entry,
        stopLoss: entry - 2 * atr,
        takeProfit: entry + 3 * atr
      };
    }

    // RSI crosses below overbought — short entry
    if (rsiPrev >= OVERBOUGHT && rsiNow < OVERBOUGHT) {
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

export default RsiReversalStrategy;
