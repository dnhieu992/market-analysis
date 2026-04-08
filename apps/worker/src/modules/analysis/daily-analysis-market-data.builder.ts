import {
  buildIndicatorSnapshot,
  type Candle,
  type DailyAnalysisMarketData,
  type IndicatorSnapshot
} from '@app/core';

import type { Trend } from '../market/utils/trend';

type TimeframeAnalysis = {
  trend: Trend;
  s1: number;
  s2: number;
  r1: number;
  r2: number;
};

type BuildDailyAnalysisMarketDataInput = {
  symbol: string;
  date: Date;
  currentPrice: number;
  d1Candles: Candle[];
  h4Candles: Candle[];
  d1: TimeframeAnalysis;
  h4: TimeframeAnalysis;
  h4Indicators: IndicatorSnapshot;
};

type MarketFlags = NonNullable<DailyAnalysisMarketData['marketFlags']>;

export function buildDailyAnalysisMarketData(
  input: BuildDailyAnalysisMarketDataInput
): DailyAnalysisMarketData {
  const d1Indicators = buildIndicatorSnapshot(input.d1Candles);
  const h4Indicators = input.h4Indicators;

  return {
    symbol: input.symbol,
    exchange: 'Binance',
    timestamp: input.date.toISOString(),
    currentPrice: input.currentPrice,
    session: 'Asia',
    strategyProfile: {
      biasFrame: 'D1',
      setupFrame: 'H4',
      entryRefinementFrame: 'none',
      strategyType: 'breakout_following',
      allowNoTrade: true,
      minimumRr: 1.5,
      preferredBreakoutRr: 2,
      avoidScalpingLogic: true
    },
    timeframes: {
      D1: buildTimeframePayload(input.d1Candles, input.d1, d1Indicators, input.currentPrice),
      H4: buildTimeframePayload(input.h4Candles, input.h4, h4Indicators, input.currentPrice)
    },
    marketFlags: deriveMarketFlags(input.d1, input.h4, h4Indicators, input.currentPrice)
  };
}

function buildTimeframePayload(
  candles: Candle[],
  analysis: TimeframeAnalysis,
  indicators: IndicatorSnapshot,
  currentPrice: number
) {
  const support = toFiniteLevelList([analysis.s1, analysis.s2], currentPrice);
  const resistance = toFiniteLevelList([analysis.r1, analysis.r2], currentPrice);

  const payload: Omit<DailyAnalysisMarketData['timeframes']['D1'], 'breakoutLevel' | 'retestZone'> & {
    breakoutLevel?: number;
    retestZone?: [number, number];
  } = {
    trend: analysis.trend,
    ohlcv: candles.map(toDailyAnalysisCandle),
    ema20: indicators.ema20,
    ema50: indicators.ema50,
    ema200: indicators.ema200,
    rsi14: indicators.rsi14,
    macd: {
      line: indicators.macd.macd,
      signal: indicators.macd.signal,
      histogram: indicators.macd.histogram
    },
    atr14: indicators.atr14,
    volumeRatio: indicators.volumeRatio,
    levels: {
      support,
      resistance
    },
    swingHigh: pickFiniteNumber(analysis.r2, analysis.r1, currentPrice),
    swingLow: pickFiniteNumber(analysis.s2, analysis.s1, currentPrice)
  };

  return payload;
}

function toDailyAnalysisCandle(candle: Candle) {
  return {
    time: toIsoTime(candle),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume ?? 0
  };
}

function toIsoTime(candle: Candle): string {
  const time = candle.closeTime ?? candle.openTime ?? new Date(0);
  return time.toISOString();
}

function deriveMarketFlags(
  d1: TimeframeAnalysis,
  h4: TimeframeAnalysis,
  h4Indicators: IndicatorSnapshot,
  currentPrice: number
): MarketFlags {
  const volumeRatio = h4Indicators.volumeRatio;
  const compressionRatio = Math.abs(h4.r2 - h4.s1) / Math.max(1, currentPrice);
  const alignedTrend = d1.trend === h4.trend && d1.trend !== 'neutral';

  return {
    majorNewsNearby: false,
    liquidityCondition: volumeRatio < 0.5 ? 'thin' : volumeRatio < 0.9 ? 'tight' : 'normal',
    marketRegime:
      compressionRatio <= 0.015
        ? 'compressed'
        : alignedTrend && volumeRatio >= 1
        ? 'trending'
        : 'ranging'
  };
}

function toFiniteLevelList(values: number[], fallback: number): number[] {
  const finiteValues = values.filter(isFiniteNumber);

  if (finiteValues.length > 0) {
    return finiteValues;
  }

  return [pickFiniteNumber(fallback, 0)];
}

function pickFiniteNumber(...values: number[]): number {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function isFiniteNumber(value: number): value is number {
  return Number.isFinite(value);
}
