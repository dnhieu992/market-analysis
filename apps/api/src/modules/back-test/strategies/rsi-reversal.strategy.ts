import { calculateRsi } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const RSI_PERIOD = 14;
const OVERSOLD = 30;
const TAKE_PROFIT_PCT = 0.10;
const STOP_LOSS_PCT = 0.10;

export class RsiReversalStrategy implements IBackTestStrategy {
  readonly name = 'rsi-reversal';
  readonly description =
    'Enter long when RSI <= 30, take profit at +10%, stop loss at -5%';
  readonly defaultTimeframe = '4h';
  readonly disableBreakeven = true;

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < RSI_PERIOD + 2) return null;

    const closes = ctx.candles.map((c) => c.close);
    const rsiNow = calculateRsi(closes, RSI_PERIOD);

    if (rsiNow > OVERSOLD) return null;

    const entry = ctx.current.close;

    return {
      direction: 'long',
      entryPrice: entry,
      stopLoss: entry * (1 - STOP_LOSS_PCT),
      takeProfit: entry * (1 + TAKE_PROFIT_PCT),
    };
  }
}

export default RsiReversalStrategy;
