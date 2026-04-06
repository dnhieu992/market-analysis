import type { Candle } from '@app/core';
import type { AnalysisTimeframe } from '@app/config';

const TIMEFRAME_TO_MS: Record<AnalysisTimeframe, number> = {
  '4h': 4 * 60 * 60 * 1000,
  'M30': 30 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '15m': 15 * 60 * 1000
};

export function timeframeToMilliseconds(timeframe: AnalysisTimeframe): number {
  return TIMEFRAME_TO_MS[timeframe];
}

export function isCandleClosed(closeTime: Date, now = new Date()): boolean {
  return closeTime.getTime() <= now.getTime();
}

export function getClosedCandles(candles: Candle[], now = new Date()): Candle[] {
  return candles.filter((candle) => candle.closeTime && isCandleClosed(candle.closeTime, now));
}

export function getLatestClosedCandle(candles: Candle[], now = new Date()): Candle | null {
  const closedCandles = getClosedCandles(candles, now);

  if (closedCandles.length === 0) {
    return null;
  }

  return closedCandles.reduce((latest, candle) => {
    if (!latest.closeTime || !candle.closeTime) {
      return latest;
    }

    return candle.closeTime > latest.closeTime ? candle : latest;
  });
}

export function deriveCandleProcessingKey(
  symbol: string,
  timeframe: AnalysisTimeframe,
  candleCloseTime: Date
): string {
  return `${symbol}:${timeframe}:${candleCloseTime.toISOString()}`;
}

export function isCandleAlreadyProcessed(
  processedKeys: Set<string>,
  symbol: string,
  timeframe: AnalysisTimeframe,
  candleCloseTime: Date
): boolean {
  return processedKeys.has(deriveCandleProcessingKey(symbol, timeframe, candleCloseTime));
}
