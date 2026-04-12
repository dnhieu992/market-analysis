import type { Candle } from '@app/core';

export type StrategyContext = {
  candles: Candle[];
  current: Candle;
  index: number;
  symbol: string;
  htfCandles: Record<string, Candle[]>; // keyed by timeframe, e.g. '4h', '1h'
  params: Record<string, unknown>;       // strategy-specific parameters from the UI
};

export type TradeSignal = {
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** If set, force-close the trade at this UTC time regardless of price */
  forceCloseTime?: Date;
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
