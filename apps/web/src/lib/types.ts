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
