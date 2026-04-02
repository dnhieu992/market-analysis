import type { Candle } from './candle';

export type IndicatorSnapshot = {
  price: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  atr14: number;
  volumeRatio: number;
  supportLevels: number[];
  resistanceLevels: number[];
  lastCandles: Array<Pick<Candle, 'open' | 'high' | 'low' | 'close'>>;
};
