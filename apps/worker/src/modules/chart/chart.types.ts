export type OhlcCandle = {
  time: number; // unix timestamp ms
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ChartInput = {
  symbol: string;
  timeframe: string;
  candles: OhlcCandle[];
  ema20: number[];   // per-candle series, aligned with candles[]
  ema50: number[];
  ema200: number[];
  supportLevels: number[];
  resistanceLevels: number[];
  currentPrice: number;
};

export type ChartOutput = {
  imageBuffer: Buffer;
  mimeType: 'image/png';
};
