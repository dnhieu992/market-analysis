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


export type PaTrend = 'StrongUp' | 'Up' | 'Neutral' | 'Down' | 'StrongDown';
export type SwingStructure = 'HH_HL' | 'HH_LL' | 'LH_HL' | 'LH_LL' | 'Mixed';

// Raw Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...]
export type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

/**
 * Price change (ratio, 0.0123 = +1.23%) per tracked coin, keyed by bare symbol.
 * The 24h column is not here — it comes from Binance's rolling 24h ticker, which
 * the page already polls for the live price.
 */
export type TrackingPriceChange = {
  symbol: string;
  change7d: number | null;
  change30d: number | null;
  change90d: number | null;
  change180d: number | null;
};

/**
 * Rule score for the "Scores" column: how many checks the coin passes out of
 * `maxScore`, plus the per-rule breakdown. `score: null` = nothing could be
 * evaluated (no data). One rule today — D1 Supertrend(10,3) bullish.
 */
export type TrackingCoinScore = {
  symbol: string;
  score: number | null;
  maxScore: number;
  rules: Record<string, boolean | null>;
};

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
};

export type TrackingCoinSetup = {
  swingMaxLoss: number | null;
  swingMinRR: number | null;
  daytradeMaxLoss: number | null;
  daytradeMinRR: number | null;
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
  /** Position take-profit trigger set on the exchange, null when none is set. */
  takeProfitPrice: number | null;
  /** Position stop-loss trigger set on the exchange, null when none is set. */
  stopLossPrice: number | null;
  /** When the position was opened (Bitget cTime). Anchors the trade-journal tradeKey. */
  openedAt: string | null;
  updatedAt: string | null;
};

export type BitgetPositionsResponse = {
  configured: boolean;
  positions: BitgetPosition[];
  totalUnrealizedPnlUsd: number;
  totalMarginUsd: number;
  accountEquityUsd: number | null;
  /** Capital the account started from, USDT — the baseline for `equityChangePct`. */
  initialCapitalUsd: number;
  /** Equity vs initial capital, in % (+/-). Null when equity is unavailable. */
  equityChangePct: number | null;
  fetchedAt: string;
};

export type BitgetClosedTrade = {
  positionId: string;
  /** Stable trade-session key — lets the history tab open the trade's journal. */
  tradeKey: string;
  status: 'closed';
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

export type BitgetTradeChart = {
  id: string;
  tradeKey: string;
  symbol: string;
  timeframe: string;
  url: string;
  objectKey: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
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

/** Per-coin, per-side manual-open config edited in the Setup dialog (persisted in the DB). */
export type BitgetSetupConfig = {
  symbol: string;
  holdSide: 'long' | 'short';
  leverage: number;
  marginUsd: number;
};

/** Lifecycle of one auto-trade day (see the Bitget auto-entry engine in the API). */
export type BitgetAutoTradeStatus = 'open' | 'extended' | 'closed' | 'skipped' | 'failed';

/**
 * Per-coin "auto vào lệnh" switch + the latest run of the 00:00 / 09:00 UTC auto
 * LONG strategy, shown in the Setup dialog.
 */
export type BitgetAutoTrade = {
  symbol: string;
  enabled: boolean;
  latestRun: {
    /** UTC date (YYYY-MM-DD) the run entered on. */
    tradeDate: string;
    status: BitgetAutoTradeStatus;
    entryPrice: number | null;
    tpPrice: number | null;
    marginUsd: number | null;
    leverage: number | null;
    exitReason: string | null;
    detail: string | null;
    updatedAt: string;
  } | null;
};

/** Manual 0–5 star rating a coin carries in the Setup tab (drives its default order). */
export type BitgetSymbolPriority = {
  symbol: string;
  priority: number;
};

/**
 * The trader's free-text assessment of one coin in the Setup tab (Markdown).
 * `updatedAt` is null when the note was just cleared.
 */
export type BitgetSymbolNote = {
  symbol: string;
  note: string;
  updatedAt: string | null;
};

/** How many saved charts one coin references — the Setup Attachments badge. */
export type BitgetChartCount = {
  symbol: string;
  count: number;
};

/** How many saved charts one trade references — the History Attachments badge. */
export type BitgetTradeChartCount = {
  tradeKey: string;
  count: number;
};

/** colinmck QQE Signals state on one timeframe's last closed candle. */
export type BitgetQqeTfSignal = {
  state: 'long' | 'short';
  barsSince: number | null;
  freshCross: boolean;
};

/** Per-coin QQE state keyed by timeframe ('M30' | '1h' | '4h' | '1d'). */
export type BitgetQqeSignals = {
  symbol: string;
  signals: Record<string, BitgetQqeTfSignal | null>;
};

/**
 * Price change (ratio, 0.0123 = +1.23%) per coin, keyed by bare symbol:
 * `changeH4` is the last CLOSED 4h candle's own move, `change7d` / `change30d`
 * compare the current close with the close N days ago.
 */
export type BitgetPriceChange = {
  symbol: string;
  changeH4: number | null;
  change7d: number | null;
  change30d: number | null;
};

export type BitgetOpenResult = {
  opened: true;
  /** 'new' = fresh position, 'add' = volume added to an already-open one. */
  mode: 'new' | 'add';
  symbol: string;
  holdSide: 'long' | 'short';
  /** Size just placed (the added amount when scaling in). */
  size: number;
  /** Total position size after this order. */
  totalSize: number;
  entryPrice: number;
  leverage: number;
  marginUsd: number;
};

/** Result of syncing a position's TP/SL to Bitget (prices as accepted by the exchange). */
export type BitgetTpslResult = {
  ok: true;
  symbol: string;
  holdSide: 'long' | 'short';
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
};

/** Price/PnL snapshot captured when a trade note was written. */
export type BitgetJournalSnapshot = {
  markPrice?: number;
  entryPrice?: number;
  roePct?: number;
  unrealizedPnlUsd?: number;
};

/** One manual note in a Bitget trade session's log timeline. */
export type BitgetJournalNote = {
  id: string;
  tradeKey: string;
  /** "manual" (trader note) or "system" (auto open/close event — read-only). */
  kind: 'manual' | 'system';
  symbol: string;
  holdSide: 'long' | 'short';
  content: string;
  images: string[];
  snapshot: BitgetJournalSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

// ─── MEXC USDT-futures (/mexc) ───────────────────────────────────────────────
// Same wire shapes as the Bitget block above, kept as their own types so the
// two exchange integrations can diverge without one breaking the other.

export type MexcPosition = {
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
  /** Position take-profit trigger set on the exchange, null when none is set. */
  takeProfitPrice: number | null;
  /** Position stop-loss trigger set on the exchange, null when none is set. */
  stopLossPrice: number | null;
  /** When the position was opened (MEXC createTime). Anchors the trade-journal tradeKey. */
  openedAt: string | null;
  updatedAt: string | null;
};

export type MexcPositionsResponse = {
  configured: boolean;
  positions: MexcPosition[];
  totalUnrealizedPnlUsd: number;
  totalMarginUsd: number;
  accountEquityUsd: number | null;
  /** Capital the account started from, USDT — the baseline for `equityChangePct`. */
  initialCapitalUsd: number;
  /** Equity vs initial capital, in % (+/-). Null when equity is unavailable. */
  equityChangePct: number | null;
  fetchedAt: string;
};

export type MexcClosedTrade = {
  positionId: string;
  /** Stable trade-session key — lets the history tab open the trade's journal. */
  tradeKey: string;
  status: 'closed';
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

export type MexcTradeChart = {
  id: string;
  tradeKey: string;
  symbol: string;
  timeframe: string;
  url: string;
  objectKey: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MexcClosedSummary = {
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

export type MexcHistoryResponse = {
  configured: boolean;
  trades: MexcClosedTrade[];
  summary: MexcClosedSummary;
  fetchedAt: string;
};

/** Per-coin, per-side manual-open config edited in the Setup dialog (persisted in the DB). */
export type MexcSetupConfig = {
  symbol: string;
  holdSide: 'long' | 'short';
  leverage: number;
  marginUsd: number;
};

/** Manual 0–5 star rating a coin carries in the Setup tab (drives its default order). */
export type MexcSymbolPriority = {
  symbol: string;
  priority: number;
};

/** A coin the trader added to the Setup tab by hand (on top of the built-in list). */
export type MexcWatchlistSymbol = {
  symbol: string;
  createdAt: string;
};

/** How many saved charts one coin references — the Setup Attachments badge. */
export type MexcChartCount = {
  symbol: string;
  count: number;
};

/** How many saved charts one trade references — the History Attachments badge. */
export type MexcTradeChartCount = {
  tradeKey: string;
  count: number;
};

/** colinmck QQE Signals state on one timeframe's last closed candle. */
export type MexcQqeTfSignal = {
  state: 'long' | 'short';
  barsSince: number | null;
  freshCross: boolean;
};

/** Per-coin QQE state keyed by timeframe ('M30' | '1h' | '4h' | '1d'). */
export type MexcQqeSignals = {
  symbol: string;
  signals: Record<string, MexcQqeTfSignal | null>;
};

/**
 * Price change (ratio, 0.0123 = +1.23%) per coin, keyed by bare symbol — each
 * field compares the current close with the close N days ago.
 */
export type MexcPriceChange = {
  symbol: string;
  change7d: number | null;
  change30d: number | null;
  change90d: number | null;
};

export type MexcOpenResult = {
  opened: true;
  /** 'new' = fresh position, 'add' = volume added to an already-open one. */
  mode: 'new' | 'add';
  symbol: string;
  holdSide: 'long' | 'short';
  /** Size just placed (the added amount when scaling in). */
  size: number;
  /** Total position size after this order. */
  totalSize: number;
  entryPrice: number;
  leverage: number;
  marginUsd: number;
};

/** Result of syncing a position's TP/SL to MEXC (prices as accepted by the exchange). */
export type MexcTpslResult = {
  ok: true;
  symbol: string;
  holdSide: 'long' | 'short';
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
};

/** Price/PnL snapshot captured when a trade note was written. */
export type MexcJournalSnapshot = {
  markPrice?: number;
  entryPrice?: number;
  roePct?: number;
  unrealizedPnlUsd?: number;
};

/** One manual note in a MEXC trade session's log timeline. */
export type MexcJournalNote = {
  id: string;
  tradeKey: string;
  /** "manual" (trader note) or "system" (auto open/close event — read-only). */
  kind: 'manual' | 'system';
  symbol: string;
  holdSide: 'long' | 'short';
  content: string;
  images: string[];
  snapshot: MexcJournalSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

/** Price/PnL snapshot captured when a /trades order note was written. */
export type OrderJournalSnapshot = {
  price?: number;
  entryPrice?: number;
  pnlUsd?: number;
};

/** One note in a /trades Order's log timeline. */
export type OrderJournalNote = {
  id: string;
  orderId: string;
  /** "manual" (trader note) or "system" (auto open/close event — read-only). */
  kind: 'manual' | 'system';
  content: string;
  images: string[];
  snapshot: OrderJournalSnapshot | null;
  createdAt: string;
  updatedAt: string;
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

/** Result of the manual Supertrend(10,3) D1 scan (POST /supertrend-scan/run). */
export type SupertrendScanResult = {
  scanned: number;
  bullish: string[];
  skipped: number;
  failed: number;
  telegramSent: boolean;
  startedAt: string;
  durationMs: number;
};

/**
 * Result of the 4H Supertrend(10,3) + QQE scan (POST /supertrend-scan/run-h4).
 * Each indicator is reported on its own; `bullish` is the intersection and
 * `flipped` the coins whose Supertrend turned bearish → bullish on the last
 * closed 4H candle.
 */
export type SupertrendH4ScanResult = SupertrendScanResult & {
  supertrendBullish: string[];
  qqeBullish: string[];
  flipped: string[];
};

// ── Asset ledger (overview asset card) ───────────────────────────────────────

/** One bucket the trader's USDT is split into. `balanceUsdt` is derived from the ledger. */
export type AssetCategory = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  balanceUsdt: number;
};

/** DEPOSIT = nạp lên sàn, WITHDRAW = rút khỏi sàn, TRANSFER = chuyển giữa 2 danh mục. */
export type AssetTransactionType = 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER';

export type AssetTransaction = {
  id: string;
  type: AssetTransactionType;
  amountUsdt: number;
  fromCategoryId: string | null;
  toCategoryId: string | null;
  note: string | null;
  occurredAt: string;
  createdAt: string;
};

/** A bucket whose balance is already committed and so not spendable. */
export type AssetDeployed = {
  key: string;
  label: string;
  balanceUsdt: number;
};

/**
 * Where a deployed bucket's PnL came from. `exchange` = live account equity,
 * `sync` = mirrored closed trades only (open positions not counted),
 * `orders` = the manual /trades book, `unknown` = nothing readable.
 */
export type AssetDeployedSource = 'exchange' | 'sync' | 'orders' | 'unknown';

/** A deployed bucket marked to market: what its capital is worth now, and the return on it. */
export type AssetDeployedValue = AssetDeployed & {
  /** Net USDT transferred in — the cost basis the return is measured against. */
  capitalUsdt: number;
  /** capital + PnL; equals capital when the PnL is unknown. */
  currentValueUsdt: number;
  realizedPnlUsdt: number;
  unrealizedPnlUsdt: number;
  /** null when no source could be read. */
  pnlUsdt: number | null;
  /** Return on capital in %; null when PnL is unknown or capital is 0. */
  pnlPct: number | null;
  source: AssetDeployedSource;
  /** Open positions exist that could not be priced — the PnL understates reality. */
  pricedPartially: boolean;
};

/** One coin held on spot, marked to Binance last price. */
export type AssetSpotPosition = {
  coinId: string;
  amount: number;
  costUsdt: number;
  marketValueUsdt: number;
  /** False when the coin had no price and fell back to its cost basis. */
  priced: boolean;
};

/** available = total − spent on spot + spot PnL (realized + unrealized) − trading − bitget − mexc. */
export type AssetAvailable = {
  availableUsdt: number;
  spentOnSpotUsdt: number;
  spotMarketValueUsdt: number;
  unrealizedSpotPnlUsdt: number;
  /** All-time realized P&L, the same figure /portfolio-pnl shows. */
  realizedSpotPnlUsdt: number;
  totalSpotPnlUsdt: number;
  /** At least one held coin had no price and was valued at cost. */
  pricedPartially: boolean;
  /** Coins still held, valued at market, largest first — the spot half of the donut. */
  spotPositions: AssetSpotPosition[];
  /** Balance of the spot bucket itself. */
  spotAllocationUsdt: number;
  /** Cash buckets — wallet and any custom bucket — counted toward available in full. */
  liquid: AssetDeployed[];
  /** Committed buckets — trading / bitget / mexc — each valued as capital + PnL. */
  deployed: AssetDeployedValue[];
};

export type AssetSummary = {
  totalUsdt: number;
  totalDepositedUsdt: number;
  totalWithdrawnUsdt: number;
  /** The ledger total marked to market: total + spot PnL + every deployed bucket's PnL. */
  currentValueUsdt: number;
  /** Spot realized + unrealized. */
  totalSpotPnlUsdt: number;
  /** Summed PnL of the deployed buckets whose value could be read. */
  totalDeployedPnlUsdt: number;
  /** spot + deployed — the whole book's result. */
  totalPnlUsdt: number;
  available: AssetAvailable;
  categories: AssetCategory[];
  transactions: AssetTransaction[];
};

export type CreateAssetTransactionInput = {
  type: AssetTransactionType;
  amountUsdt: number;
  fromCategoryId?: string;
  toCategoryId?: string;
  note?: string;
  occurredAt?: string;
};
