import { calculateRsi, calculateEma, calculateAtr } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const RSI_PERIOD = 14;
const SIGNAL_PERIOD = 9;
// Minimum candles: RSI_PERIOD + SIGNAL_PERIOD + 1 extra for crossover comparison
const MIN_CANDLES = RSI_PERIOD + SIGNAL_PERIOD + 1;

/**
 * Build an RSI series: one value per candle starting from index RSI_PERIOD.
 */
function buildRsiSeries(closes: number[]): number[] {
  const series: number[] = [];
  for (let i = RSI_PERIOD; i < closes.length; i++) {
    series.push(calculateRsi(closes.slice(0, i + 1), RSI_PERIOD));
  }
  return series;
}

export class RsiSignalCrossoverStrategy implements IBackTestStrategy {
  readonly name = 'rsi-signal-crossover';
  readonly description =
    'Long when RSI crosses above its EMA-9 signal line and RSI < 30 or RSI > 50. ' +
    'Short when RSI crosses below its EMA-9 signal line and RSI < 50.';
  readonly defaultTimeframe = '4h';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < MIN_CANDLES + 1) return null;

    const closes = ctx.candles.map((c) => c.close);

    // Full RSI series and one without the last value (for crossover detection)
    const rsiSeries = buildRsiSeries(closes);
    const rsiSeriesPrev = buildRsiSeries(closes.slice(0, -1));

    if (rsiSeries.length < SIGNAL_PERIOD || rsiSeriesPrev.length < SIGNAL_PERIOD) return null;

    const rsiNow = rsiSeries[rsiSeries.length - 1]!;
    const rsiPrev = rsiSeriesPrev[rsiSeriesPrev.length - 1]!;

    const signalNow = calculateEma(rsiSeries, SIGNAL_PERIOD);
    const signalPrev = calculateEma(rsiSeriesPrev, SIGNAL_PERIOD);

    const highs = ctx.candles.map((c) => c.high);
    const lows = ctx.candles.map((c) => c.low);
    const atr = calculateAtr(highs, lows, closes, RSI_PERIOD);

    const entry = ctx.current.close;

    // Long: RSI crosses above signal line AND (RSI < 30 OR RSI > 50)
    if (rsiPrev <= signalPrev && rsiNow > signalNow && (rsiNow < 30 || rsiNow > 50)) {
      return {
        direction: 'long',
        entryPrice: entry,
        stopLoss: entry - 2 * atr,
        takeProfit: entry + 3 * atr
      };
    }

    // Short: RSI crosses below signal line AND RSI < 50
    if (rsiPrev >= signalPrev && rsiNow < signalNow && rsiNow < 50) {
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

export default RsiSignalCrossoverStrategy;
