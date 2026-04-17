import { calculateRsi } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const RSI_PERIOD = 14;
const OVERSOLD = 30;
const DEFAULT_TP_PCT = 0.10;
const DEFAULT_SL_PCT = 0.10;

export class RsiReversalStrategy implements IBackTestStrategy {
  readonly name = 'rsi-reversal';
  readonly description =
    'Enter long when RSI <= 30. Params: tpPct (default 0.10), slPct (default 0.10)';
  readonly defaultTimeframe = '4h';
  readonly disableBreakeven = true;

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < RSI_PERIOD + 2) return null;

    const closes = ctx.candles.map((c) => c.close);
    const rsiNow = calculateRsi(closes, RSI_PERIOD);

    if (rsiNow > OVERSOLD) return null;

    const tpPct = typeof ctx.params.tpPct === 'number' ? ctx.params.tpPct : DEFAULT_TP_PCT;
    const slPct = typeof ctx.params.slPct === 'number' ? ctx.params.slPct : DEFAULT_SL_PCT;

    const entry = ctx.current.close;

    return {
      direction: 'long',
      entryPrice: entry,
      stopLoss: entry * (1 - slPct),
      takeProfit: entry * (1 + tpPct),
    };
  }
}

export default RsiReversalStrategy;
