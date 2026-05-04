import type { Candle } from '@app/core';
import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const DEFAULT_ENTRY_HOUR_UTC = 0;
const DEFAULT_EXIT_HOUR_UTC = 16;
const DEFAULT_TP_PCT = 0.01; // 1%
const DEFAULT_UT_BOT_PERIOD = 10;
const DEFAULT_UT_BOT_MULTIPLIER = 1;

// Wilder's RMA-based ATR
function calcAtr(candles: Candle[], period: number): number[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1]!;
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });

  const atr: number[] = new Array(candles.length).fill(0);
  if (candles.length < period) return atr;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  }

  return atr;
}

// UT Bot trailing stop — same logic as the TradingView script
function calcUtBotTrailingStop(candles: Candle[], period: number, multiplier: number): number[] {
  const atr = calcAtr(candles, period);
  const stop: number[] = new Array(candles.length).fill(0);

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i]!.close;
    const nLoss = atr[i]! * multiplier;

    if (i === 0) {
      stop[i] = close - nLoss;
      continue;
    }

    const prevClose = candles[i - 1]!.close;
    const prevStop = stop[i - 1]!;

    if (close > prevStop && prevClose > prevStop) {
      stop[i] = Math.max(prevStop, close - nLoss);
    } else if (close < prevStop && prevClose < prevStop) {
      stop[i] = Math.min(prevStop, close + nLoss);
    } else if (close > prevStop) {
      stop[i] = close - nLoss;
    } else {
      stop[i] = close + nLoss;
    }
  }

  return stop;
}

// Returns true when the last candle's close is above the UT Bot trailing stop
function isUtBotUptrend(candles: Candle[], period: number, multiplier: number): boolean {
  if (candles.length < period + 1) return false;
  const stop = calcUtBotTrailingStop(candles, period, multiplier);
  const last = candles.length - 1;
  return candles[last]!.close > stop[last]!;
}

export class FomoLongStrategy implements IBackTestStrategy {
  readonly name = 'fomo-long';
  readonly description =
    'Long at 00:00 UTC every day when M30 UT Bot is uptrend. TP = entry × (1 + tpPct). Force close at 16:00 UTC if TP not reached. No price-based stop loss.';
  readonly defaultTimeframe = '1h';
  readonly forcedTimeframe = '1h';
  readonly htfTimeframes = ['M30'];

  evaluate(ctx: StrategyContext): TradeSignal | null {
    const { current, params, htfCandles } = ctx;

    const entryHour    = typeof params.entryHourUtc     === 'number' ? params.entryHourUtc     : DEFAULT_ENTRY_HOUR_UTC;
    const exitHour     = typeof params.exitHourUtc      === 'number' ? params.exitHourUtc      : DEFAULT_EXIT_HOUR_UTC;
    const tpPct        = typeof params.tpPct            === 'number' ? params.tpPct            : DEFAULT_TP_PCT;
    const utBotPeriod  = typeof params.utBotPeriod      === 'number' ? params.utBotPeriod      : DEFAULT_UT_BOT_PERIOD;
    const utBotMult    = typeof params.utBotMultiplier  === 'number' ? params.utBotMultiplier  : DEFAULT_UT_BOT_MULTIPLIER;

    if (!current.openTime) return null;

    // Only enter on the candle that opens at entryHour UTC
    if (current.openTime.getUTCHours() !== entryHour) return null;

    // Gate: M30 UT Bot must be in uptrend at entry time
    const m30Candles = (htfCandles['M30'] ?? []).filter(
      (c) => c.openTime != null && c.openTime <= current.openTime!
    );

    if (!isUtBotUptrend(m30Candles, utBotPeriod, utBotMult)) return null;

    const entry = current.close;

    // Force-close time: exitHour UTC on the same calendar day as the entry candle
    const forceCloseTime = new Date(current.openTime);
    forceCloseTime.setUTCHours(exitHour, 0, 0, 0);

    return {
      direction: 'long',
      entryPrice: entry,
      stopLoss: entry - 999_999, // no price-based SL — time is the only stop
      takeProfit: entry * (1 + tpPct),
      forceCloseTime
    };
  }
}

export default FomoLongStrategy;
