import { isUtBotUptrend } from '@app/core';
import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const DEFAULT_ENTRY_HOUR_UTC = 0;
const DEFAULT_EXIT_HOUR_UTC = 16;
const DEFAULT_TP_PCT = 0.01; // 1%
const DEFAULT_UT_BOT_PERIOD = 10;
const DEFAULT_UT_BOT_MULTIPLIER = 1;

export class FomoLongStrategy implements IBackTestStrategy {
  readonly name = 'fomo-long';
  readonly description =
    'Long at 00:00 UTC every day when M30 UT Bot is uptrend. TP = entry × (1 + tpPct). Force close at 16:00 UTC if TP not reached. No price-based stop loss.';
  readonly defaultTimeframe = '1h';
  readonly forcedTimeframe = '1h';
  readonly htfTimeframes = ['M30'];

  evaluate(ctx: StrategyContext): TradeSignal | null {
    const { current, params, htfCandles } = ctx;

    const entryHour   = typeof params.entryHourUtc    === 'number' ? params.entryHourUtc    : DEFAULT_ENTRY_HOUR_UTC;
    const exitHour    = typeof params.exitHourUtc     === 'number' ? params.exitHourUtc     : DEFAULT_EXIT_HOUR_UTC;
    const tpPct       = typeof params.tpPct           === 'number' ? params.tpPct           : DEFAULT_TP_PCT;
    const utBotPeriod = typeof params.utBotPeriod     === 'number' ? params.utBotPeriod     : DEFAULT_UT_BOT_PERIOD;
    const utBotMult   = typeof params.utBotMultiplier === 'number' ? params.utBotMultiplier : DEFAULT_UT_BOT_MULTIPLIER;

    if (!current.openTime) return null;
    if (current.openTime.getUTCHours() !== entryHour) return null;

    const m30Candles = (htfCandles['M30'] ?? []).filter(
      (c) => c.openTime != null && c.openTime <= current.openTime!
    );

    if (!isUtBotUptrend(m30Candles, utBotPeriod, utBotMult)) return null;

    const entry = current.close;
    const forceCloseTime = new Date(current.openTime);
    forceCloseTime.setUTCHours(exitHour, 0, 0, 0);

    return {
      direction: 'long',
      entryPrice: entry,
      stopLoss: entry - 999_999,
      takeProfit: entry * (1 + tpPct),
      forceCloseTime
    };
  }
}

export default FomoLongStrategy;
