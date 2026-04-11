export type DashboardOrder = {
  id: string;
  symbol: string;
  side: 'long' | 'short' | string;
  status: string;
  entryPrice: number;
  openedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  closePrice?: number | null;
  pnl?: number | null;
  quantity?: number | null;
  leverage?: number | null;
  note?: string | null;
  source?: string;
  exchange?: string | null;
  signalId?: string | null;
};

export type DashboardSignal = {
  id: string;
  analysisRunId: string;
  symbol: string;
  timeframe: string;
  trend: 'uptrend' | 'downtrend' | 'sideways' | string;
  bias: 'bullish' | 'bearish' | 'neutral' | string;
  confidence: number;
  summary: string;
  supportLevels: number[];
  resistanceLevels: number[];
  invalidation: string;
  bullishScenario: string;
  bearishScenario: string;
  createdAt: Date;
};

export type DashboardAnalysisRun = {
  id: string;
  symbol: string;
  timeframe: string;
  candleOpenTime: Date;
  candleCloseTime: Date;
  priceOpen: number;
  priceHigh: number;
  priceLow: number;
  priceClose: number;
  rawIndicatorsJson: string;
  llmInputJson: string;
  llmOutputJson: string;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DashboardHealth = {
  service: string;
  status: string;
};

export type CreateDashboardOrderInput = {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  quantity?: number;
  leverage?: number;
  exchange?: string;
  openedAt?: string;
  note?: string;
  signalId?: string;
};

export type CloseDashboardOrderInput = {
  closePrice: number;
  note?: string;
  closedAt?: string;
};

export type DailyAnalysis = {
  aiOutput: DailyAnalysisPlan;
  id: string;
  symbol: string;
  date: string;
  status: 'TRADE_READY' | 'WAIT' | 'NO_TRADE';
  d1Trend: 'bullish' | 'bearish' | 'neutral';
  h4Trend: 'bullish' | 'bearish' | 'neutral';
  d1S1: number;
  d1S2: number;
  d1R1: number;
  d1R2: number;
  h4S1: number;
  h4S2: number;
  h4R1: number;
  h4R2: number;
  llmProvider: string;
  llmModel: string;
  pipelineDebugJson: string | null;
  summary: string;
  createdAt: string;
};

export type TrackingSettings = {
  id: string;
  name: string;
  trackingSymbols: string[];
  createdAt: string;
  updatedAt: string;
};

export type UpsertSettingsInput = {
  name: string;
  trackingSymbols: string[];
};

export type BackTestStrategy = {
  name: string;
  description: string;
  defaultTimeframe: string;
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

export type BackTestResult = {
  id: string;
  strategy: string;
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  trades: BackTestTrade[];
};

export type BackTestResultRecord = {
  id: string;
  strategy: string;
  symbol: string;
  timeframe: string;
  fromDate: string;
  toDate: string;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  status: string;
  createdAt: string;
};

export type RunBackTestInput = {
  strategy: string;
  symbol: string;
  from: string;
  to: string;
  timeframe?: string;
};
import type { DailyAnalysisPlan } from '@app/core';
