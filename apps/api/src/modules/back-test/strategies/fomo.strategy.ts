import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const DEFAULT_ENTRY_HOUR_UTC = 3;
const DEFAULT_EXIT_HOUR_UTC = 16;
const DEFAULT_TP_STEPS = 1000;

export class FomoStrategy implements IBackTestStrategy {
  readonly name = 'fomo-short';
  readonly description =
    'Short at 03:00 UTC every day. TP = 1000 price steps. Force close at 16:00 UTC if TP not reached. No price-based stop loss.';
  readonly defaultTimeframe = '1h';
  readonly forcedTimeframe = '1h';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    const { current, params } = ctx;

    const entryHour = typeof params.entryHourUtc === 'number' ? params.entryHourUtc : DEFAULT_ENTRY_HOUR_UTC;
    const exitHour  = typeof params.exitHourUtc  === 'number' ? params.exitHourUtc  : DEFAULT_EXIT_HOUR_UTC;
    const tpSteps   = typeof params.tpSteps      === 'number' ? params.tpSteps      : DEFAULT_TP_STEPS;

    if (!current.openTime) return null;

    // Only enter on the candle that opens at entryHour UTC
    if (current.openTime.getUTCHours() !== entryHour) return null;

    const entry = current.close;

    // Force-close time: exitHour UTC on the same calendar day as the entry candle
    const forceCloseTime = new Date(current.openTime);
    forceCloseTime.setUTCHours(exitHour, 0, 0, 0);

    return {
      direction: 'short',
      entryPrice: entry,
      stopLoss: entry + 999_999, // no price-based SL — time is the only stop
      takeProfit: entry - tpSteps,
      forceCloseTime
    };
  }
}

export default FomoStrategy;
