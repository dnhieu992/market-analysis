import { Injectable } from '@nestjs/common';
import { calculateAtr } from '@app/core';
import type { Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';

export type PriceActionSignal = {
  symbol: string;
  timeframe: 'M30';
  direction: 'BUY' | 'SELL' | 'NO_SIGNAL';
  close: number;
  atr: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  keyLevel: number | null;
  pattern: string | null;
  bosLevel: number | null;
  stopLoss?: number;
  target?: number;
};

function detectTrend(candles: Candle[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]!;
    const curr = candles[i]!;
    const next = candles[i + 1]!;

    if (curr.high > prev.high && curr.high > next.high) swingHighs.push(curr.high);
    if (curr.low < prev.low && curr.low < next.low) swingLows.push(curr.low);
  }

  if (swingHighs.length < 2 || swingLows.length < 2) return 'NEUTRAL';

  const lastTwoHighs = swingHighs.slice(-2) as [number, number];
  const lastTwoLows = swingLows.slice(-2) as [number, number];

  const hhhl = lastTwoHighs[1] > lastTwoHighs[0] && lastTwoLows[1] > lastTwoLows[0];
  const lhll = lastTwoHighs[1] < lastTwoHighs[0] && lastTwoLows[1] < lastTwoLows[0];

  if (hhhl) return 'BULLISH';
  if (lhll) return 'BEARISH';
  return 'NEUTRAL';
}

function findActiveKeyLevel(
  candles: Candle[],
  close: number,
  atr: number,
  trend: 'BULLISH' | 'BEARISH'
): number | null {
  const slice = candles.slice(-50);
  const swingPoints: number[] = [];

  for (let i = 1; i < slice.length - 1; i++) {
    const prev = slice[i - 1]!;
    const curr = slice[i]!;
    const next = slice[i + 1]!;

    if (trend === 'BULLISH' && curr.low < prev.low && curr.low < next.low) {
      swingPoints.push(curr.low);
    }
    if (trend === 'BEARISH' && curr.high > prev.high && curr.high > next.high) {
      swingPoints.push(curr.high);
    }
  }

  // Find most recent swing point within 1×ATR
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
    // Bullish pin bar
    if (
      lowerWick >= 2 * bodySize &&
      Math.min(curr.open, curr.close) >= curr.low + 0.7 * range
    ) {
      return { name: 'Pin Bar', direction: 'bullish' };
    }
    // Bearish pin bar
    if (
      upperWick >= 2 * bodySize &&
      Math.max(curr.open, curr.close) <= curr.low + 0.3 * range
    ) {
      return { name: 'Pin Bar', direction: 'bearish' };
    }
  }

  // Bullish engulfing
  if (
    curr.close > curr.open &&
    prev.close < prev.open &&
    curr.open <= prev.close &&
    curr.close >= prev.open
  ) {
    return { name: 'Engulfing', direction: 'bullish' };
  }

  // Bearish engulfing
  if (
    curr.close < curr.open &&
    prev.close > prev.open &&
    curr.open >= prev.close &&
    curr.close <= prev.open
  ) {
    return { name: 'Engulfing', direction: 'bearish' };
  }

  return null;
}

function detectBos(
  candles: Candle[],
  atr: number,
  trend: 'BULLISH' | 'BEARISH'
): number | null {
  if (candles.length < 10) return null;

  // Find the last swing point before the last 5 candles
  const lookback = candles.slice(0, -5);
  const recent = candles.slice(-5);

  let bosLevel: number | null = null;

  if (trend === 'BULLISH') {
    // Find most recent swing high in lookback
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

    // Check if any recent candle broke above that level
    const broken = recent.some((c) => c.high > bosLevel!);
    if (!broken) return null;

    // Check retest: any recent candle closed within 0.5×ATR of broken level
    const retested = recent.some((c) => Math.abs(c.close - bosLevel!) <= 0.5 * atr);
    if (!retested) return null;
    return bosLevel;
  }

  if (trend === 'BEARISH') {
    // Find most recent swing low in lookback
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

    const broken = recent.some((c) => c.low < bosLevel!);
    if (!broken) return null;

    const retested = recent.some((c) => Math.abs(c.close - bosLevel!) <= 0.5 * atr);
    if (!retested) return null;
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

    if (trend === 'NEUTRAL') {
      return {
        symbol, timeframe: 'M30', direction: 'NO_SIGNAL',
        close, atr, trend, keyLevel: null, pattern: null, bosLevel: null
      };
    }

    const keyLevel = findActiveKeyLevel(m30Candles, close, atr, trend);
    const patternResult = detectPattern(m30Candles);
    const patternMatch =
      patternResult &&
      ((trend === 'BULLISH' && patternResult.direction === 'bullish') ||
        (trend === 'BEARISH' && patternResult.direction === 'bearish'));
    const pattern = patternMatch ? patternResult.name : null;
    const bosLevel = detectBos(m30Candles, atr, trend);

    const allAligned = keyLevel !== null && pattern !== null && bosLevel !== null;

    if (!allAligned) {
      return {
        symbol, timeframe: 'M30', direction: 'NO_SIGNAL',
        close, atr, trend, keyLevel, pattern, bosLevel
      };
    }

    const direction = trend === 'BULLISH' ? 'BUY' : 'SELL';
    const stopLoss = keyLevel;
    const target =
      direction === 'BUY'
        ? Number((close + 2 * atr).toFixed(2))
        : Number((close - 2 * atr).toFixed(2));

    return {
      symbol, timeframe: 'M30', direction,
      close, atr, trend, keyLevel, pattern, bosLevel,
      stopLoss, target
    };
  }
}
