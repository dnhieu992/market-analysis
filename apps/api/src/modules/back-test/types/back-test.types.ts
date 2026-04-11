import type { Candle } from '@app/core';

export type StrategyContext = {
  candles: Candle[];
  current: Candle;
  index: number;
  symbol: string;
};

export type TradeSignal = {
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
};

export type BackTestTrade = {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'long' | 'short';
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
