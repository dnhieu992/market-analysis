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

export type TrackedSetupStatus =
  | 'PENDING'
  | 'ENTERED'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'SL_HIT'
  | 'INVALID'
  | 'EXPIRED'
  | string;

export type TrackedSetup = {
  id: string;
  dailyAnalysisId: string;
  symbol: string;
  planDate: string;
  slot: 'primary' | 'secondary' | string;
  direction: 'long' | 'short' | string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number | null;
  takeProfit2: number | null;
  status: TrackedSetupStatus;
  enteredAt: string | null;
  tp1HitAt: string | null;
  tp2HitAt: string | null;
  slHitAt: string | null;
  closedAt: string | null;
  invalidatedReason: string | null;
  notes: string | null;
  lastPrice: number | null;
  lastCheckedAt: string | null;
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

export type TradeChartSnapshot = {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  pivots: Array<{ idx: number; price: number; role: string }>;
  neckline: number;
  target: number;
  stop: number;
  direction: 'bullish' | 'bearish';
  pattern: string;
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
  chartSnapshot?: TradeChartSnapshot;
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

export type SmallCapStage = 'Breakout' | 'Trending' | 'Accumulating' | 'Waking' | 'Extended' | 'Oversold' | 'Quiet';

export type PaTrend = 'StrongUp' | 'Up' | 'Neutral' | 'Down' | 'StrongDown';
export type SwingStructure = 'HH_HL' | 'HH_LL' | 'LH_HL' | 'LH_LL' | 'Mixed';

// Raw Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...]
export type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

export type TrackingCoinRow = {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  addedAt: string;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    wEma34Above: boolean | null;
    wEma89Above: boolean | null;
    wEma200Above: boolean | null;
    h4Ema34Above: boolean | null;
    h4Ema89Above: boolean | null;
    h4Ema200Above: boolean | null;
    utBotW1Bullish: boolean | null;
    utBotD1Bullish: boolean | null;
    utBotH4Bullish: boolean | null;
    utBotM30Bullish: boolean | null;
    wRsi: number | null;
    wVolMultiplier: number | null;
    h4Rsi: number | null;
    h4VolMultiplier: number | null;
    m30Ema34Above: boolean | null;
    m30Ema89Above: boolean | null;
    m30Ema200Above: boolean | null;
    m30Rsi: number | null;
    m30VolMultiplier: number | null;
    longScore: number | null;
    shortScore: number | null;
    signalScore: number;
    entryScore: number;
    dcaScore: number;
    dcaZone: 'GOM' | 'CHO' | 'CHOT';
    accZone: 'GOM' | 'CHO' | 'CHOT' | null;
    accDrawdownPct: number | null;
    accBaseWidthPct: number | null;
    accInBase: boolean | null;
    accGatePassed: boolean | null;
    gomZone: {
      zoneLow: number;
      zoneHigh: number;
      ladder: number[];
      avgCost: number;
      targetX2: number;
    } | null;
    extPct: number | null;
    low20Pct: number | null;
    sparkline: number[];
    weekTrend: PaTrend;
    trend: PaTrend;
    h4Trend: PaTrend;
    m30Trend: PaTrend;
    swingStructure: SwingStructure;
    scannedAt: string;
  } | null;
  dcaPosition: { layers: number; avgEntry: number; capitalDeployed: number } | null;
};

export type SignalHistoryRow = {
  id: string;
  dcaScore: number;
  dcaZone: 'GOM' | 'CHO' | 'CHOT' | null;
  dcaBucket: 'safe' | 'ok' | 'risky' | 'avoid';
  trend: PaTrend;
  weekTrend: PaTrend;
  h4Trend: PaTrend;
  rsi: number | null;
  extPct: number | null;
  price: number | null;
  // Daily LLM (Haiku) holding review — present only on review rows.
  entryMode: 'SIGNAL' | 'FOMO' | 'MIXED' | null;
  avgEntry: number | null;
  pnlPct: number | null;
  llmVerdict: 'GIU' | 'GOM_THEM' | 'CHOT_BOT' | 'THOAT' | null;
  llmReview: string | null;
  llmModel: string | null;
  scannedAt: string;
};

export type DcaBuy = {
  id: string;
  price: number;
  usd: number;
  boughtAt: string;
  portfolioId: string | null;
};

export type DcaPosition = {
  symbol: string;
  currentPrice: number;
  maxLayers: number;
  layers: number;
  avgEntry: number | null;
  capitalDeployed: number;
  nextAddPrice: number | null;
  pnlPct: number | null;
  buys: DcaBuy[];
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
  /** True once price reached +1R and the stop was ratcheted to break-even (entry). */
  breakEvenMoved: boolean;
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
  scratch: number;
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

export type BitgetPosition = {
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  leverage: number;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  breakEvenPrice: number | null;
  marginUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  roePct: number;
  realizedPnlUsd: number;
  updatedAt: string | null;
};

export type BitgetPositionsResponse = {
  configured: boolean;
  positions: BitgetPosition[];
  totalUnrealizedPnlUsd: number;
  totalMarginUsd: number;
  fetchedAt: string;
};

export type BitgetClosedTrade = {
  positionId: string;
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  openAvgPrice: number;
  closeAvgPrice: number;
  size: number;
  netProfit: number;
  netProfitPct: number;
  totalFunding: number;
  feesUsd: number;
  openedAt: string;
  closedAt: string;
};

export type BitgetClosedSummary = {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalNetProfit: number;
  avgNetProfit: number;
  bestNetProfit: number;
  worstNetProfit: number;
  totalVolumeUsd: number;
};

export type BitgetHistoryResponse = {
  configured: boolean;
  trades: BitgetClosedTrade[];
  summary: BitgetClosedSummary;
  fetchedAt: string;
};

// ── Long Signal (LONG-only intraday FOMO gated by the M30 UTBot trend) ─────────

export type LongSignal = {
  id: string;
  symbol: string;
  direction: 'LONG';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  keyValue: number;
  entryLineDistancePct: number | null;
  quantity: number | null;
  positionValue: number | null;
  status: 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'FORCE_CLOSE' | 'MANUAL_CLOSE' | 'FAILED';
  mode: 'PAPER' | 'LIVE';
  brokerOrderId: string | null;
  closedPrice: number | null;
  closedAt: string | null;
  pnlUsd: number | null;
  setupJson: string;
  note: string | null;
  detectedAt: string;
  createdAt: string;
};

export type LongSignalsResponse = {
  data: LongSignal[];
  total: number;
  limit: number;
  offset: number;
};

export type LongSignalStats = {
  total: number;
  active: number;
  tpHit: number;
  slHit: number;
  forceClose: number;
  manualClose: number;
  wins: number;
  winRate: number;
  totalPnlUsd: number;
};

export type LongSignalSettings = {
  notional: number;
  keyValue: number;
  atrPeriod: number;
  tpPct: number;
  catastropheStopPct: number;
  entryHour: number;
  exitHour: number;
  leverage: number;
  symbols: string;
  mode: 'PAPER' | 'LIVE';
};

export type UpdateLongSignalSettingsInput = Partial<LongSignalSettings>;

export type LongSignalLiveStatus = {
  /** Server env LIVE_TRADING_ENABLED === 'true'. */
  envEnabled: boolean;
  /** Bitget API key/secret/passphrase all present on the server. */
  bitgetConfigured: boolean;
  /** envEnabled && bitgetConfigured — real orders only fire when this is true. */
  armed: boolean;
};

export type LongSignalPrices = {
  prices: Record<string, number>;
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
    extPct: number | null;
    sparkline: number[];
    trend: PaTrend;
    swingStructure: SwingStructure;
    scannedAt: string;
  } | null;
};

export type SmallCapHistoryRow = {
  id: string;
  stage: SmallCapStage;
  signalScore: number;
  trend: PaTrend;
  rsi: number | null;
  volMultiplier: number | null;
  extPct: number | null;
  price: number | null;
  scannedAt: string;
};

// ── Meme Radar ────────────────────────────────────────────────────────────────
// Same shape/engine as Small Cap Radar; the universe is meme-token coins on Binance.
export type MemeStage = SmallCapStage;
export type MemeCoinRow = SmallCapCoinRow;
export type MemeHistoryRow = SmallCapHistoryRow;

// ── Pattern Scanner ─────────────────────────────────────────────────────────────
export type PatternKind = 'double_bottom' | 'double_top' | 'head_shoulders' | 'inverse_head_shoulders';

export type PatternWatchCoin = {
  id: string;
  symbol: string;
  name: string;
  addedAt: string;
};

export type PatternMatch = {
  pattern: PatternKind;
  direction: 'bullish' | 'bearish';
  status: 'forming' | 'confirmed';
  neckline: number;
  target: number;
  stop: number;
  heightPct: number;
  barsAgo: number;
  pivots: { idx: number; price: number; role: string }[];
};

export type CoinIndicators = {
  rsi: number;
  ema34: number;
  ema89: number;
  ema200: number;
};

export type PatternSignalBreakdown = {
  rsiBull: number;
  rsiBear: number;
  emaBull: number;
  emaBear: number;
  patternBull: number;
  patternBear: number;
};

export type PatternSignal = {
  bullPoints: number;
  bearPoints: number;
  bullPct: number;
  bearPct: number;
  breakdown: PatternSignalBreakdown;
};

export type PatternScanCoinResult = {
  symbol: string;
  name: string;
  price: number;
  /** OHLC series used for the scan (oldest → newest, parallel arrays); pivot `idx` indexes into these. Used to draw the pattern candlestick chart. */
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  matches: PatternMatch[];
  indicators: CoinIndicators;
  signal: PatternSignal;
};

export type PatternScanResult = {
  scannedAt: string;
  timeframe: string;
  patterns: PatternKind[];
  scanned: number;
  failed: number;
  coins: PatternScanCoinResult[];
};

export type PatternReferenceImage = {
  id: string;
  pattern: PatternKind;
  imageUrl: string;
  notes: string | null;
  createdAt: string;
};

// ── EMA Bounce Scanner (EMA-stack oversold StochRSI) ──────────────────────────
export type EmaBounceCoin = {
  id: string;
  symbol: string;
  name: string;
  addedAt: string;
};

export type EmaBounceSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  status: 'open' | 'hit_tp' | 'expired' | string;
  stage: 'near' | 'reach' | 'risk' | string;
  note: string | null;
  score: number;
  /** Higher-TF PA trend scored by the PA block (D1 for a 4H card, W1 for a D1 card). */
  htfTrend: PaTrend | null;
  /** Entry-TF swing structure scored by the PA block. */
  swingStructure: SwingStructure | null;
  triggeredAt: string;
  entryPrice: number;
  tpPrice: number;
  distPct: number;
  rsi: number | null;
  stochK: number | null;
  stochD: number | null;
  ema34: number | null;
  ema89: number | null;
  ema200: number | null;
  currentPrice: number | null;
  pnlPct: number | null;
  hitTpAt: string | null;
  lastCheckedAt: string | null;
};

export type EmaBounceMatch = {
  symbol: string;
  timeframe: string;
  stage: 'near' | 'reach' | 'risk' | string;
  note: string;
  score: number;
  price: number;
  tpPrice: number;
  distPct: number;
  rsi: number;
  stochK: number;
  stochD: number;
  ema34: number;
  ema89: number;
  ema200: number;
  htfTrend: PaTrend;
  swingStructure: SwingStructure;
};

export type EmaBouncePreview = {
  scannedAt: string;
  scanned: number;
  failed: number;
  matches: EmaBounceMatch[];
};

/** A daily trading-journal entry (one per calendar day). */
export type TradingJournalEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  content: string;
  images: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** One save of a day's journal, as it looked at that moment (intra-day history). */
export type TradingJournalRevision = {
  id: string;
  content: string;
  images: string[];
  tags: string[];
  createdAt: string; // ISO timestamp of the save
};

/** Progress/result of the background coin sync (polled after a Sync Coins click). */
export type MemeRescanStatus = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  found: number | null;
  upserted: number | null;
  removed: number | null;
  error: string | null;
};

// ── BTC DCA Ladder ────────────────────────────────────────────────────────────

export type DcaLadderSettings = {
  startCapital: number;
  firstTierPct: number;
  bearFirstTierPct: number;
  numTiers: number;
  stepPct: number;
  tpPct: number;
  feePct: number;
  enabled: boolean;
};

export type DcaLadderCycle = {
  id: string;
  cycleNumber: number;
  status: 'FLAT' | 'IN_POSITION' | 'CLOSED';
  peak: number;
  budget: number;
  avgCost: number | null;
  positionSize: number | null;
  tpPrice: number | null;
  realizedPnl: number | null;
};

export type DcaLadderOrder = {
  id: string;
  side: 'BUY' | 'SELL';
  tierIndex: number | null;
  plannedPrice: number;
  fillPrice: number | null;
  usdAmount: number | null;
  qty: number | null;
  status: 'ARMED' | 'PENDING_FILL' | 'FILLED' | 'CANCELLED';
};

export type DcaLadderSummary = {
  cycleCount: number;
  avgFillsPerCycle: number;
  realizedPnl: number;
  unrealizedPnl: number;
};

export type DcaLadderTimingSignal = {
  zone: 'GOM' | 'CHO' | 'CHOT';
  score: number;
  bucket: 'safe' | 'ok' | 'risky' | 'avoid';
  rsi: number | null;
  ema34Above: boolean | null;
  low20Pct: number | null;
  weekTrend: 'StrongUp' | 'Up' | 'Neutral' | 'Down' | 'StrongDown';
};

export type DcaLadderState = {
  settings: DcaLadderSettings;
  cycle: DcaLadderCycle;
  orders: DcaLadderOrder[];
  livePrice: number;
  timingSignal: DcaLadderTimingSignal | null;
  summary: DcaLadderSummary;
};

export type SpotFlipAnalysis = {
  symbol: string;
  price: number;
  changes: {
    h1: number | null;
    h4: number | null;
    h24: number | null;
    d7: number | null;
    d30: number | null;
  };
  pullbackPct: number;
  reboundPct: number;
  high30d: number;
  low30d: number;
  atrPct: number;
  history: SpotFlipHistoryEntry[];
  updatedAt: string;
};

export type SpotFlipHistoryEntry = {
  date: string;
  open: number;
  close: number;
  changePct: number | null;
};

export type SpotFlipWatchItem = {
  symbol: string;
  name: string;
};

export type SpotFlipDailyEntry = {
  date: string;
  price: number;
  upPct: number;
  downPct: number;
  pullbackPct: number;
  reboundPct: number;
  atrPct: number;
  changeH24: number | null;
  notes: string | null;
};

export type SpotFlipLogEntry = {
  id: string;
  content: string;
  createdAt: string;
};

/**
 * An image stored in Cloudflare R2 (returned by POST /uploads/images).
 * `key` is the R2 object key (used to delete), `url` is the public URL.
 */
export type ImageRef = {
  key: string;
  url: string;
  name?: string;
  size?: number;
  type?: string;
};
