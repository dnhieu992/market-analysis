import { Injectable } from '@nestjs/common';
import { calculateAtr } from '@app/core';
import type { Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';
import { detectTrend } from '../market/utils/trend';
import type { Trend } from '../market/utils/trend';

export type PriceActionSignal = {
  symbol: string;
  timeframe: 'M30';
  direction: 'BUY' | 'SELL' | 'NO_SIGNAL';
  close: number;
  atr: number;
  trend: Trend;
  keyLevel: number | null;
  pattern: string | null;
  bosLevel: number | null;
  stopLoss?: number;
  target?: number;
};

function findActiveKeyLevel(
  candles: Candle[],
  close: number,
  atr: number,
  trend: 'bullish' | 'bearish'
): number | null {
  const slice = candles.slice(-50);
  const swingPoints: number[] = [];

  for (let i = 1; i < slice.length - 1; i++) {
    const prev = slice[i - 1]!;
    const curr = slice[i]!;
    const next = slice[i + 1]!;

    if (trend === 'bullish' && curr.low < prev.low && curr.low < next.low) {
      swingPoints.push(curr.low);
    }
    if (trend === 'bearish' && curr.high > prev.high && curr.high > next.high) {
      swingPoints.push(curr.high);
    }
  }

  for (let i = swingPoints.length - 1; i >= 0; i--) {
    const level = swingPoints[i]!;
    if (Math.abs(close - level) <= atr) return level;
  }

  return null;
}

function detectPattern(
  candles: Candle[]
): { name: string; direction: 'bullish' | 'bearish' } | null {
  if (candles.length < 2) return null;

  const curr = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2]!;

  const bodySize = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low;
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const upperWick = curr.high - Math.max(curr.open, curr.close);

  if (range > 0 && bodySize > 0) {
    if (lowerWick >= 2 * bodySize && Math.min(curr.open, curr.close) >= curr.low + 0.7 * range) {
      return { name: 'Pin Bar', direction: 'bullish' };
    }
    if (upperWick >= 2 * bodySize && Math.max(curr.open, curr.close) <= curr.low + 0.3 * range) {
      return { name: 'Pin Bar', direction: 'bearish' };
    }
  }

  if (curr.close > curr.open && prev.close < prev.open && curr.open <= prev.close && curr.close >= prev.open) {
    return { name: 'Engulfing', direction: 'bullish' };
  }
  if (curr.close < curr.open && prev.close > prev.open && curr.open >= prev.close && curr.close <= prev.open) {
    return { name: 'Engulfing', direction: 'bearish' };
  }

  return null;
}

function detectBos(candles: Candle[], atr: number, trend: 'bullish' | 'bearish'): number | null {
  if (candles.length < 10) return null;

  const lookback = candles.slice(0, -5);
  const recent = candles.slice(-5);
  let bosLevel: number | null = null;

  if (trend === 'bullish') {
    for (let i = lookback.length - 2; i >= 1; i--) {
      const prev = lookback[i - 1]!;
      const curr = lookback[i]!;
      const next = lookback[i + 1]!;
      if (curr.high > prev.high && curr.high > next.high) {
        bosLevel = curr.high;
        break;
      }
    }
    if (bosLevel === null) return null;
    if (!recent.some((c) => c.high > bosLevel!)) return null;
    if (!recent.some((c) => Math.abs(c.close - bosLevel!) <= 0.5 * atr)) return null;
    return bosLevel;
  }

  if (trend === 'bearish') {
    for (let i = lookback.length - 2; i >= 1; i--) {
      const prev = lookback[i - 1]!;
      const curr = lookback[i]!;
      const next = lookback[i + 1]!;
      if (curr.low < prev.low && curr.low < next.low) {
        bosLevel = curr.low;
        break;
      }
    }
    if (bosLevel === null) return null;
    if (!recent.some((c) => c.low < bosLevel!)) return null;
    if (!recent.some((c) => Math.abs(c.close - bosLevel!) <= 0.5 * atr)) return null;
    return bosLevel;
  }

  return null;
}

@Injectable()
export class PriceActionSignalService {
  constructor(private readonly marketDataService: MarketDataService) {}

  async getSignal(symbol: string): Promise<PriceActionSignal> {
    const h4Candles = await this.marketDataService.getCandles(symbol, '4h', 20);
    const m30Candles = await this.marketDataService.getCandles(symbol, 'M30', 100);

    const highs = m30Candles.map((c) => c.high);
    const lows = m30Candles.map((c) => c.low);
    const closes = m30Candles.map((c) => c.close);
    const close = closes[closes.length - 1] ?? 0;
    const atr = calculateAtr(highs, lows, closes, 14);

    const trend = detectTrend(h4Candles);

    if (trend === 'neutral') {
      return {
        symbol,
        timeframe: 'M30',
        direction: 'NO_SIGNAL',
        close,
        atr,
        trend,
        keyLevel: null,
        pattern: null,
        bosLevel: null
      };
    }

    const keyLevel = findActiveKeyLevel(m30Candles, close, atr, trend);
    const patternResult = detectPattern(m30Candles);
    const patternMatch =
      patternResult &&
      ((trend === 'bullish' && patternResult.direction === 'bullish') ||
        (trend === 'bearish' && patternResult.direction === 'bearish'));
    const pattern = patternMatch ? patternResult.name : null;
    const bosLevel = detectBos(m30Candles, atr, trend);
    const allAligned = keyLevel !== null && pattern !== null && bosLevel !== null;

    if (!allAligned) {
      return { symbol, timeframe: 'M30', direction: 'NO_SIGNAL', close, atr, trend, keyLevel, pattern, bosLevel };
    }


    const direction = trend === 'bullish' ? 'BUY' : 'SELL';
    const stopLoss = keyLevel;
    const target = direction === 'BUY' ? Number((close + 2 * atr).toFixed(2)) : Number((close - 2 * atr).toFixed(2));

    return {
      symbol,
      timeframe: 'M30',
      direction,
      close,
      atr,
      trend,
      keyLevel,
      pattern,
      bosLevel,
      stopLoss,
      target
    };
  }
}
