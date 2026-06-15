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
  feedbackScore: number | null;
  feedbackNote: string | null;
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
  images: string[];
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
  note: string | null;
};

export type PnlSnapshot = {
  id: string;
  portfolioId: string;
  coinId: string | null;
  date: string;
  unrealizedPnl: number;
  totalValue: number;
};

export type PortfolioPnlCalendar = {
  daily: { date: string; realizedPnl: number }[];
  byCoin: { coinId: string; realizedPnl: number }[];
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
  note?: string;
  images?: string[];
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

export type SmallCapStage = 'Breakout' | 'Accumulating' | 'Waking' | 'Extended' | 'Quiet';

export type PaTrend = 'StrongUp' | 'Up' | 'Neutral' | 'Down' | 'StrongDown';
export type SwingStructure = 'HH_HL' | 'HH_LL' | 'LH_HL' | 'LH_LL' | 'Mixed';

// Raw Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...]
export type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

export type TrackingCoinRow = {
  id: string;
  symbol: string;
  name: string;
  addedAt: string;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    h4Ema34Above: boolean | null;
    h4Ema89Above: boolean | null;
    h4Ema200Above: boolean | null;
    utBotD1Bullish: boolean | null;
    utBotH4Bullish: boolean | null;
    h4Rsi: number | null;
    h4VolMultiplier: number | null;
    longScore: number | null;
    shortScore: number | null;
    signalScore: number;
    sparkline: number[];
    trend: PaTrend;
    h4Trend: PaTrend;
    m30Trend: PaTrend;
    swingStructure: SwingStructure;
    scannedAt: string;
  } | null;
};

export type OrderSuggestion = {
  id: string;
  side: 'LONG' | 'SHORT';
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number | null;
  sl: number;
  rrRatio: number;
  rationale: string;
  notes: string | null;
};

export type OrderSuggestions = {
  symbol: string;
  currentPrice: number;
  swing: OrderSuggestion | null;
  generatedAt: string;
};

export type TrackingCoinOrder = {
  id: string;
  date: string;
  type: 'swing' | 'daytrade';
  side: 'LONG' | 'SHORT';
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number | null;
  sl: number;
  rrRatio: number;
  rationale: string;
  notes: string | null;
  positionSize: number | null;
  positionValue: number | null;
  activated: boolean | null;
  outcome: 'tp1' | 'tp2' | 'sl' | 'expired' | null;
  evaluatedAt: string | null;
  createdAt: string;
};

export type CoinSetup = {
  swingMaxLoss: number | null;
  swingMinRR: number | null;
  daytradeMaxLoss: number | null;
  daytradeMinRR: number | null;
};

export type DayTradingSignal = {
  id: string;
  symbol: string;
  setupType: 'BREAK_RETEST' | 'LIQUIDITY_SWEEP' | 'TREND_PULLBACK' | 'RANGE_FADE';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrRatio: number;
  riskAmount: number;
  quantity: number | null;
  positionValue: number | null;
  status: 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'EXPIRED';
  mode: 'PAPER' | 'LIVE';
  closedPrice: number | null;
  closedAt: string | null;
  pnlUsd: number | null;
  setupJson: string;
  note: string | null;
  detectedAt: string;
  createdAt: string;
};

export type DayTradingSignalsResponse = {
  data: DayTradingSignal[];
  total: number;
  limit: number;
  offset: number;
};

export type DayTradingStats = {
  total: number;
  active: number;
  tpHit: number;
  slHit: number;
  winRate: number;
  totalPnlUsd: number;
};

export type DayTradingSettings = {
  riskPerTrade: number;
  minRR: number;
  maxTradesPerDay: number;
  maxLossesPerDay: number;
};

export type UpdateDayTradingSettingsInput = Partial<DayTradingSettings>;

export type DayTradingPrice = {
  price: number;
  at: string;
};

// ── Swing Trading (UTBot trend stop-and-reverse on candle close) ──────────────

export type SwingTradingSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  setupType: 'UTBOT_FLIP';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrRatio: number;
  riskAmount: number;
  keyValue: number;
  quantity: number | null;
  positionValue: number | null;
  status: 'ACTIVE' | 'CLOSED';
  mode: 'PAPER' | 'LIVE';
  closedPrice: number | null;
  closedAt: string | null;
  pnlUsd: number | null;
  setupJson: string;
  note: string | null;
  detectedAt: string;
  createdAt: string;
};

export type SwingTradingSignalsResponse = {
  data: SwingTradingSignal[];
  total: number;
  limit: number;
  offset: number;
};

export type SwingTradingStats = {
  total: number;
  active: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlUsd: number;
};

export type SwingTradingSettings = {
  symbol: string;
  timeframe: string;
  atrPeriod: number;
  keyValue: number;
  riskPerTrade: number;
  leverage: number;
  mode: 'PAPER' | 'LIVE';
};

export type UpdateSwingTradingSettingsInput = Partial<SwingTradingSettings>;

export type SwingTradingPrice = {
  price: number;
  at: string;
};

export type SmallCapCoinRow = {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  listingDate: string | null;
  addedAt: string;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    stage: SmallCapStage;
    signalScore: number;
    sparkline: number[];
    trend: PaTrend;
    swingStructure: SwingStructure;
    scannedAt: string;
  } | null;
};
