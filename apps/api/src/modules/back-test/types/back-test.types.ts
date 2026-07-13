import type { Candle } from '@app/core';

export type StrategyContext = {
  candles: Candle[];
  current: Candle;
  index: number;
  symbol: string;
  htfCandles: Record<string, Candle[]>; // keyed by timeframe, e.g. '4h', '1h'
  params: Record<string, unknown>;       // strategy-specific parameters from the UI
};

/** Pre-sliced OHLC window + pattern geometry attached to a trade for chart rendering. */
export type TradeChartSnapshot = {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  /** Pivot points with idx remapped relative to the sliced window. */
  pivots: Array<{ idx: number; price: number; role: string }>;
  neckline: number;
  target: number;
  stop: number;
  direction: 'bullish' | 'bearish';
  pattern: string;
};

export type TradeSignal = {
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** If set, force-close the trade at this UTC time regardless of price */
  forceCloseTime?: Date;
  /** If true, the engine calls strategy.getTrailingStopLoss() each candle to ratchet the SL */
  trailingStop?: boolean;
  /** Optional chart snapshot for visual review — populated by strategies that detect patterns. */
  chartSnapshot?: TradeChartSnapshot;
};

export type BackTestTrade = {
  entryIndex: number;
  exitIndex: number;
  entryTime: Date | null;
  exitTime: Date | null;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  direction: 'long' | 'short';
  size: number;
  pnl: number;
  pnlPercent: number;
  outcome: 'win' | 'loss' | 'breakeven';
  chartSnapshot?: TradeChartSnapshot;
};

export type BackTestSummary = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  trades: BackTestTrade[];
};
