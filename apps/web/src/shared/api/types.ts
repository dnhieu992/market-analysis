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
  images?: string[] | null;
  source?: string;
  exchange?: string | null;
  broker?: string | null;
  orderType?: string | null;
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
  broker?: string;
  orderType?: 'market' | 'limit';
  openedAt?: string;
  note?: string;
  images?: string[];
  signalId?: string;
};

export type CloseDashboardOrderInput = {
  closePrice: number;
  note?: string;
  closedAt?: string;
};

export type UpdateDashboardOrderInput = {
  symbol?: string;
  side?: 'long' | 'short';
  entryPrice?: number;
  closePrice?: number;
  quantity?: number;
  openedAt?: string;
  note?: string;
  images?: string[];
  exchange?: string;
  broker?: string;
  orderType?: 'market' | 'limit';
};

export type DailyAnalysis = {
  aiOutput: DailyAnalysisPlan;
  id: string;
  symbol: string;
  date: string;
  status: 'TRADE_READY' | 'WAIT' | 'NO_TRADE' | 'PUBLISHED' | string;
  d1Trend: 'bullish' | 'bearish' | 'neutral' | null;
  h4Trend: 'bullish' | 'bearish' | 'neutral' | null;
  d1S1: number | null;
  d1S2: number | null;
  d1R1: number | null;
  d1R2: number | null;
  h4S1: number | null;
  h4S2: number | null;
  h4R1: number | null;
  h4R2: number | null;
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
  entryTime: string | null;
  exitTime: string | null;
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
  volume?: number;
  parametersJson?: string;
  status: string;
  createdAt: string;
};

export type BackTestResult = {
  id: string;
  strategy: string;
  symbol: string;
  timeframe: string;
  from?: string;
  to?: string;
  fromDate?: string;
  toDate?: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  trades: BackTestTrade[];
};

export type RunBackTestInput = {
  strategy: string;
  symbol: string;
  from: string;
  to: string;
  timeframe?: string;
  volume?: number;
  params?: Record<string, unknown>;
};
export type TradingStrategy = {
  id: string;
  name: string;
  content: string;
  imageReference: string[];
  version: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateTradingStrategyInput = {
  name: string;
  content: string;
  imageReference?: string[];
  version: string;
};

export type UpdateTradingStrategyInput = {
  name?: string;
  content?: string;
  imageReference?: string[];
  version?: string;
};

export type Portfolio = {
  id: string;
  name: string;
  description: string | null;
  totalCapital: number | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type CoinTransaction = {
  id: string;
  portfolioId: string;
  coinId: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  totalValue: number;
  fee: number;
  note: string | null;
  transactedAt: string;
  deletedAt: string | null;
  createdAt: string;
};

export type Holding = {
  portfolioId: string;
  coinId: string;
  totalAmount: number;
  avgCost: number;
  totalInvested: number;
  realizedPnl: number;
};

export type PnlSnapshot = {
  id: string;
  portfolioId: string;
  coinId: string | null;
  date: string;
  unrealizedPnl: number;
  totalValue: number;
};

export type CreatePortfolioInput = {
  name: string;
  description?: string;
  totalCapital?: number;
};

export type UpdatePortfolioInput = {
  name?: string;
  description?: string;
  totalCapital?: number;
};

export type CreateTransactionInput = {
  coinId: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  transactedAt?: string;
};

export type QueryTransactionsInput = {
  coinId?: string;
  type?: 'buy' | 'sell';
  from?: string;
  to?: string;
};

export type QueryPnlInput = {
  from?: string;
  to?: string;
  coinId?: string;
};

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  symbolsTracking: string[];
  dailySignalWatchlist: string[];
};

export type UpdateProfileInput = {
  name?: string;
  symbolsTracking?: string[];
};


export type Skill = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tools: string[];
  exampleQuestions: string[];
  welcomeMessage: string;
};

export type Conversation = {
  id: string;
  title: string;
  skillId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

import type { DailyAnalysisPlan } from '@app/core';

export type OrderFilterParams = {
  symbol?: string;
  status?: string;
  broker?: string;      // comma-separated, e.g. "Binance,Bybit"
  dateFrom?: string;    // ISO date string, e.g. "2025-01-01"
  dateTo?: string;      // ISO date string, e.g. "2025-05-01"
  page?: number;
  pageSize?: number;
};

export type PaginatedOrders = {
  data: DashboardOrder[];
  total: number;
  page: number;
  pageSize: number;
  closedPnlSum: number;
  openOrders: DashboardOrder[];
};

export type DcaConfig = {
  id: string;
  userId: string;
  coin: 'BTC' | 'ETH';
  totalBudget: number;
  portfolioId: string;
  createdAt: string;
  updatedAt: string;
};

export type DcaPlanItem = {
  id: string;
  dcaPlanId: string;
  type: 'buy' | 'sell';
  targetPrice: number;
  suggestedAmount: number;
  note: string | null;
  source: 'llm' | 'user';
  userModified: boolean;
  deletedByUser: boolean;
  originalTargetPrice: number | null;
  originalSuggestedAmount: number | null;
  status: 'pending' | 'executed' | 'skipped';
  executedPrice: number | null;
  executedAmount: number | null;
  executedAt: string | null;
  createdAt: string;
};

export type DcaPlan = {
  id: string;
  dcaConfigId: string;
  status: 'active' | 'archived';
  llmAnalysis: string | null;
  createdAt: string;
  archivedAt: string | null;
  items: DcaPlanItem[];
};

export type DcaCapitalState = {
  totalBudget: number;
  deployedAmount: number;
  remaining: number;
  runnerAmount: number;
  runnerAvgCost: number;
};

export type DcaActivePlanResponse = {
  config: DcaConfig;
  plan: DcaPlan | null;
  capital: DcaCapitalState;
};

export type CreateDcaConfigInput = {
  coin: 'BTC' | 'ETH';
  totalBudget: number;
  portfolioId: string;
};

export type UpdateDcaConfigInput = {
  totalBudget?: number;
  portfolioId?: string;
};

export type CreateDcaPlanItemInput = {
  type: 'buy' | 'sell';
  targetPrice: number;
  suggestedAmount: number;
  note?: string;
};

export type UpdateDcaPlanItemInput = {
  type?: 'buy' | 'sell';
  targetPrice?: number;
  suggestedAmount?: number;
  note?: string;
};

export type ExecuteDcaPlanItemInput = {
  executedPrice: number;
  executedAmount: number;
  executedAt?: string;
};
