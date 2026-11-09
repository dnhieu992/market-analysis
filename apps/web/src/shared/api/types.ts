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
  note: string | null;
  imageReference: string[];
  version: string;
  createdAt: string;
  updatedAt: string;
};

export type StrategyHistoryEntry = {
  id: string;
  strategyId: string;
  title: string;
  content: string;
  createdAt: string;
};

export type CreateTradingStrategyInput = {
  name: string;
  content: string;
  note?: string | null;
  imageReference?: string[];
  version: string;
};

export type UpdateTradingStrategyInput = {
  name?: string;
  content?: string;
  note?: string | null;
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
  /** Total money ever spent buying this coin (gross of sells) — the ROI % denominator. */
  grossInvested: number;
  realizedPnl: number;
  note: string | null;
};

/** One price band the daily review named — a buy zone or a sell zone. */
export type ReviewZone = {
  low: number;
  high: number;
  /** Distance from the review-time price, in percent (negative = below). */
  distancePct: number | null;
  touches: number | null;
};

/** One coin's verdict from the daily 00:00 UTC Claude portfolio review. */
export type HoldingReview = {
  coinId: string;
  /** UTC report date, `YYYY-MM-DD`. */
  reviewDate: string;
  verdict: string;
  previousVerdict: string | null;
  /** True when this report moved the verdict off yesterday's. */
  changed: boolean;
  price: number | null;
  reason: string | null;
  metrics: Record<string, unknown> | null;
  buyZones: ReviewZone[];
  sellZones: ReviewZone[];
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
};

/** One step of the login state machine (POST /auth/login…). */
export type LoginStepResponse =
  | { step: 'change-password' | 'enroll-totp' | 'totp'; challenge: string }
  | { step: 'done'; user: { id: string; email: string; name: string }; backupCodes?: string[] };

export type TotpSetup = { secret: string; otpauthUrl: string; qrDataUrl: string };

export type AuthSecurity = {
  totpEnabledAt: string | null;
  backupCodesRemaining: number;
  passwordChangedAt: string | null;
};

/** A signed-in session or a trusted (2FA-remembered) browser. */
export type AuthDevice = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
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
  /** { symbol } for a /tracking-coins panel chat. */
  metadata?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** Trade setups the skill proposed in this reply (Accept / Cancel cards). */
  setups?: SkillTradeSetup[];
  /** Swing setups proposed in a /tracking-coins panel chat. */
  trackingSetups?: TrackingSetup[];
  /** Action cards proposed by the /bitget AI chat. */
  bitgetActions?: BitgetAiAction[];
  /** Action cards proposed by the /mexc AI chat. */
  mexcActions?: MexcAiAction[];
  /** SHORT cards proposed by the /trades OKX short AI chat. */
  okxActions?: OkxAiAction[];
  /** Spot buy/sell cards proposed by the Spot Analytic (/tracking-coins) chat. */
  spotTrades?: SpotTradeCard[];
};

export type BitgetAiActionType = 'OPEN' | 'DCA' | 'SET_TP' | 'CLOSE' | 'CANCEL';

/** What a /bitget AI card carries (Claude's proposal; the confirm dialog may override it). */
export type BitgetAiActionParams = {
  orderType?: 'MARKET' | 'LIMIT';
  price?: number | null;
  marginUsd?: number;
  leverage?: number;
  takeProfitPrice?: number | null;
  closePct?: number;
  orderId?: string;
  refPrice?: number | null;
  prevAvg?: number;
  newAvg?: number;
  prevSize?: number;
  addSize?: number;
  prevTp?: number | null;
  entry?: number;
  size?: number;
  pnlUsd?: number;
};

export type BitgetAiAction = {
  id: string;
  conversationId: string;
  messageId: string | null;
  type: BitgetAiActionType;
  symbol: string;
  holdSide: 'long' | 'short';
  params: BitgetAiActionParams;
  reason: string | null;
  status: 'PROPOSED' | 'EXECUTED' | 'FAILED' | 'DISMISSED';
  executedParams: BitgetAiActionParams | null;
  result: Record<string, unknown> | null;
  orderId: string | null;
  error: string | null;
  decidedAt: string | null;
  createdAt: string;
};

/** The user's edits from the confirm dialog. */
export type BitgetAiActionEdits = Pick<BitgetAiActionParams, 'orderType' | 'marginUsd' | 'leverage' | 'closePct'> & {
  price?: number;
  takeProfitPrice?: number | null;
};

/** The /mexc AI chat's cards — same shape as the /bitget ones, stored in `mexc_ai_actions`. */
export type MexcAiAction = BitgetAiAction;
export type MexcAiActionEdits = BitgetAiActionEdits;

/** The /trades OKX AI chat's cards (holdSide 'long' or 'short'), stored in `okx_ai_actions`. */
export type OkxAiAction = BitgetAiAction;
export type OkxAiActionEdits = BitgetAiActionEdits;

/** One live OKX SWAP position (GET /okx/account). Size is in coin; contracts is the exchange unit. */
export type OkxPosition = {
  symbol: string;
  instId: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  leverage: number;
  size: number;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  marginUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  roePct: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  openedAt: string | null;
  posId: string | null;
};

export type OkxAccount = {
  configured: boolean;
  positions: OkxPosition[];
  equityUsd: number | null;
  availableUsd: number | null;
  totalMarginUsd: number;
  totalUnrealizedPnlUsd: number;
  posMode: 'long_short_mode' | 'net_mode' | null;
  /** False when the OKX API key has no Trade permission. */
  canTrade: boolean | null;
  fetchedAt: string;
};

/** Editable analysis skill of the OKX short chat (GET /okx/ai/skill). version 0 = code default. */
export type ShortSkillVersion = {
  version: number;
  content: string;
  note: string | null;
  author: 'USER' | 'LLM';
  createdAt: string;
};

export type ShortSkill = {
  version: number;
  content: string;
  isDefault: boolean;
  updatedAt: string | null;
  history: Array<Omit<ShortSkillVersion, 'content'> & { chars: number }>;
};

/** BTC SHORT checklist score of the /trades OKX chat (GET /okx/ai/score). */
export type ShortScoreCriterion = { id: string; label: string; points: number; hit: boolean; detail: string | null; error?: string };

export type ShortScoreView = {
  symbol: string;
  takenAt: string;
  price: number | null;
  scorePct: number;
  hitPoints: number;
  maxPoints: number;
  criteriaVersion: number;
  trigger: string;
  criteria: ShortScoreCriterion[];
};

export type ShortScoreOverview = {
  latest: ShortScoreView | null;
  recent: Array<{ takenAt: string; scorePct: number; hitPoints: number; maxPoints: number; price: number | null; version: number; trigger: string }>;
  criteriaVersion: number;
  criteriaCount: number;
};

/** Progress of the reply being generated (GET /chat/conversations/:id/live). */
export type LiveReply = {
  active: boolean;
  phase: 'idle' | 'thinking' | 'tool' | 'writing' | 'done' | 'stopped' | 'error';
  /** Tool being run while phase = 'tool', e.g. get_scalp_chart_data. */
  tool: string | null;
  /** Text of the current turn written so far. */
  text: string;
  error: string | null;
  elapsedMs: number;
};

/** A trade setup proposed by a chat skill (shown as a card under the reply). */
export type SkillTradeSetup = {
  id: string;
  conversationId: string;
  messageId: string | null;
  skillId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  setupType: string | null;
  confidence: string | null;
  note: string | null;
  status: 'PROPOSED' | 'ACCEPTED' | 'CANCELLED';
  decidedAt: string | null;
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
  change3d: number | null;
  change7d: number | null;
  change30d: number | null;
  change90d: number | null;
  change180d: number | null;
};

/** Live price + rolling 24h change (ratio) per bare symbol — API `/tracking-coins/tickers`. */
export type TrackingTicker = { symbol: string; price: number; change24h: number | null };

/** Market cap (Binance circulating supply × price) and sector labels (L1, L2, Meme, DeFi, AI…). */
export type TrackingCoinMeta = { symbol: string; marketCap: number | null; sectors: string[] };

/** A spot buy/sell card proposed by the Spot Analytic chat; written to the portfolio on confirm. */
export type SpotTradeCard = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  portfolioId: string;
  portfolioName?: string;
  transactedAt: string;
  note: string | null;
  status: 'PENDING' | 'CONFIRMING' | 'CONFIRMED' | 'CANCELLED';
  transactionId: string | null;
};

export type SpotPosition = {
  portfolioId: string;
  portfolioName: string;
  amount: number;
  avgCost: number;
  totalCost: number;
  realizedPnl: number;
  txCount: number;
  lastTxAt: string | null;
};

export type SpotHistory = {
  symbol: string;
  trades: Array<{ id: string; side: 'buy' | 'sell'; price: number; amount: number; value: number; portfolioId: string; portfolioName: string; transactedAt: string; note: string | null; removed: boolean }>;
  positions: SpotPosition[];
};

export type TrackingCoinRow = {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  addedAt: string;
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
  /**
   * Web-only: set by the SSR fallback when the exchange call FAILED (timeout,
   * 5xx). Distinct from `configured: false` — the keys exist, the exchange was
   * just slow — so the UI must not say "API not configured".
   */
  unavailable?: boolean;
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

/** Result of placing a resting LIMIT entry on Bitget (as accepted by the exchange). */
export type BitgetLimitResult = {
  placed: true;
  symbol: string;
  holdSide: 'long' | 'short';
  size: number;
  price: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  orderId: string;
};

/** One resting (unfilled) LIMIT order shown in the "Lệnh chờ (limit)" panel. */
export type BitgetPendingOrder = {
  orderId: string;
  symbol: string;
  holdSide: 'long' | 'short';
  /** Limit price the order waits to fill at. */
  price: number;
  /** Base-asset size. */
  size: number;
  leverage: number;
  /** size × price. */
  notionalUsd: number;
  /** notional ÷ leverage. */
  marginUsd: number;
  createdAt: string | null;
};

export type BitgetPendingOrdersResponse = {
  configured: boolean;
  orders: BitgetPendingOrder[];
  fetchedAt: string;
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
  /**
   * Web-only: set by the SSR fallback when the exchange call FAILED (timeout,
   * 5xx). Distinct from `configured: false` — the keys exist, the exchange was
   * just slow — so the UI must not say "API not configured".
   */
  unavailable?: boolean;
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

/** Result of placing a resting LIMIT entry on MEXC (as accepted by the exchange). */
export type MexcLimitResult = {
  placed: true;
  symbol: string;
  holdSide: 'long' | 'short';
  size: number;
  price: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  orderId: string;
};

/** One resting (unfilled) LIMIT order shown in the "Lệnh chờ (limit)" panel. */
export type MexcPendingOrder = {
  orderId: string;
  symbol: string;
  holdSide: 'long' | 'short';
  /** Limit price the order waits to fill at. */
  price: number;
  /** Base-asset size. */
  size: number;
  leverage: number;
  /** size × price. */
  notionalUsd: number;
  /** notional ÷ leverage. */
  marginUsd: number;
  createdAt: string | null;
};

export type MexcPendingOrdersResponse = {
  configured: boolean;
  orders: MexcPendingOrder[];
  fetchedAt: string;
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
  scope?: string; // GENERAL (/journal) | STRATEGY_BACKTEST — omitted by older callers
  date: string; // YYYY-MM-DD
  content: string;
  /** 'USER' = the trader wrote/edited it; 'LLM' = the daily market-journal cron. Missing → USER. */
  author?: 'USER' | 'LLM';
  images: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** One save of a day's journal, as it looked at that moment (intra-day history). */
export type TradingJournalRevision = {
  id: string;
  content: string;
  /** 'USER' or 'LLM' — who made this particular save. Missing → USER. */
  author?: 'USER' | 'LLM';
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

/** Lifecycle of a manual setup on /strategy-backtest. */
export type StrategyBacktestStatus =
  | 'PENDING'
  | 'ENTERED'
  | 'TP_HIT'
  | 'SL_HIT'
  | 'CLOSED'
  /** Called off by the trader. The only way a setup leaves the board — nothing is deleted. */
  | 'INVALID';

/** Horizon the setup was planned on — a scalp and a swing are not comparable. */
export type StrategyBacktestSetupType = 'SWING' | 'SCALP';

/** LIMIT waits at `entryPrice`; MARKET is entered at the live price the moment it is saved. */
export type StrategyBacktestOrderType = 'LIMIT' | 'MARKET';

/**
 * One hand-written setup tracked like a resting limit order. `plannedRr` and the
 * three live fields are computed by the API, never stored — the page only displays.
 */
export type StrategyBacktestSetup = {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  setupType: StrategyBacktestSetupType;
  orderType: StrategyBacktestOrderType;
  /** For a MARKET setup this is the live price captured when it was saved. */
  entryPrice: number;
  stopLoss: number;
  takeProfit: number | null;
  note: string | null;
  /** Cloudflare R2 URLs of the charts the analysis was based on. */
  images: string[];
  /**
   * Post-mortem written after the fact, markdown. `note` is the plan going in,
   * `review` is the verdict coming out — kept apart so neither overwrites the other.
   */
  review: string | null;
  /** Screenshots attached to the review (the replay charts), separate from `images`. */
  reviewImages: string[];
  /** Last time the review was saved with actual text; null = never reviewed. */
  reviewedAt: string | null;
  status: StrategyBacktestStatus;
  /** Why the setup was called off, when the trader bothered to say. */
  invalidReason: string | null;
  triggeredAt: string | null;
  closedAt: string | null;
  exitPrice: number | null;
  /** Realized % on the entry, net of 0.05%/side fees. Null while still open. */
  pnlPct: number | null;
  rMultiple: number | null;
  lastPrice: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  plannedRr: number | null;
  /** How far price still is from the limit; only on PENDING setups. */
  distanceToEntryPct: number | null;
  /** Live result of a filled setup; only on ENTERED setups. */
  unrealizedPct: number | null;
  unrealizedR: number | null;
};

export type StrategyBacktestBoard = {
  price: number | null;
  symbol: string;
  setups: StrategyBacktestSetup[];
};

export type CreateStrategyBacktestSetupInput = {
  direction: 'LONG' | 'SHORT';
  setupType: StrategyBacktestSetupType;
  orderType: StrategyBacktestOrderType;
  /** Omitted for MARKET — the server captures the live price instead. */
  entryPrice?: number;
  stopLoss: number;
  takeProfit?: number;
  note?: string;
  images?: string[];
};

export type UpdateStrategyBacktestSetupInput = {
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number | null;
  note?: string;
  /** Empty string clears the review. Editable in every status, unlike the prices. */
  review?: string;
  reviewImages?: string[];
};



// ── /tracking-coins swing setups (paper) ─────────────────────────────────────

export type TrackingSetupStatus = 'PROPOSED' | 'WATCHING' | 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'DISCARDED';

export type TrackingTarget = { price: number; pct: number; hitAt?: string | null; exitPrice?: number | null };

export type TrackingSetup = {
  id: string;
  symbol: string;
  pair?: string;
  source: 'CLAUDE' | 'MANUAL';
  conversationId: string | null;
  direction: 'LONG' | 'SHORT';
  orderType: 'LIMIT' | 'STOP' | 'MARKET';
  status: TrackingSetupStatus;
  setupType: string | null;
  timeframe: string;
  confidence: string | null;
  thesis: string | null;
  triggerNote: string | null;
  invalidation: string | null;
  entryPrice: number;
  stopLoss: number;
  targets: TrackingTarget[];
  riskUsd: number;
  fillPrice: number | null;
  quantity: number | null;
  remainingQty: number | null;
  currentStop: number | null;
  placedAt: string | null;
  filledAt: string | null;
  closedAt: string | null;
  closeReason: 'TP' | 'SL' | 'BE' | 'TRAIL' | 'MANUAL' | null;
  realizedPnlUsd: number | null;
  rMultiple: number | null;
  manualIntervention: boolean;
  lastPrice: number | null;
  mfeR: number | null;
  maeR: number | null;
  rating: number | null;
  reviewNote: string | null;
  postMortem: string | null;
  createdAt: string;
  updatedAt: string;
  plannedRR?: number[];
  riskPct?: number;
  unrealizedR?: number | null;
};

export type TrackingEvent = {
  id: string;
  symbol: string;
  setupId: string | null;
  type: string;
  price: number | null;
  message: string;
  data: Record<string, unknown> | null;
  images: string[] | null;
  chartUrl: string | null;
  createdAt: string;
};

export type TrackingGroupStat = { group: string; trades: number; winRate: number; totalR: number; avgR: number };

export type TrackingStats = {
  closed: number;
  winRate: number | null;
  totalR: number;
  avgR: number | null;
  avgRating: number | null;
  bySetupType: TrackingGroupStat[];
  bySymbol: TrackingGroupStat[];
  byDirection: TrackingGroupStat[];
  bySource: TrackingGroupStat[];
  byIntervention: TrackingGroupStat[];
  byCloseReason: TrackingGroupStat[];
};

export type TrackingLessonBatch = {
  id: string;
  tradeCount: number;
  draft: string;
  content: string | null;
  status: 'DRAFT' | 'APPROVED';
  approvedAt: string | null;
  createdAt: string;
};

export type TrackingOverview = {
  setups: TrackingSetup[];
  stats: TrackingStats;
  config: { riskUsd: number };
  lessons: { batches: TrackingLessonBatch[]; unbatched: number; batchSize: number; canDraft: boolean };
};

export type TrackingSetupInput = {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  orderType: 'LIMIT' | 'STOP' | 'MARKET';
  entryPrice: number;
  stopLoss: number;
  targets: number[];
  targetPcts?: number[];
  setupType?: string;
  thesis?: string;
  triggerNote?: string;
  invalidation?: string;
};

// ── /trading-list (Bitget + MEXC on one page) ─────────────────────────────────

/** Which exchange a /trading-list action targets. */
export type TradingExchange = 'bitget' | 'mexc';

/** Star priority shared by both exchanges on /trading-list. */
export type TradingListPriority = {
  symbol: string;
  priority: number;
};

/** The trader's assessment of a coin on /trading-list (shared by both exchanges). */
export type TradingListNote = {
  symbol: string;
  note: string;
  updatedAt: string | null;
};

/** A coin added to /trading-list by hand. */
/** One coin of /trading-list (the DB table is the only source of the list). */
/** A coin on the /short-junk list — the only coins the short-junk skill scans. */
export type JunkShortCoin = {
  id: string;
  symbol: string;
  note: string | null;
  /** MANUAL = added by hand · BINANCE_SYNC = imported by "Sync từ Binance". */
  source: 'MANUAL' | 'BINANCE_SYNC' | string;
  createdAt: string;
  updatedAt: string;
};

export type AddJunkCoinsResult = { added: JunkShortCoin[]; rejected: string[] };

/** Live Binance stats for one listed coin (GET /junk-short/coins/stats). */
export type JunkCoinStat = {
  symbol: string;
  name: string | null;
  price: number | null;
  marketCapUsd: number | null;
  quoteVolume24hUsd: number | null;
  change24hPct: number | null;
  change3dPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  change90dPct: number | null;
  /** Highest weekly high on Binance spot + futures. */
  athPrice: number | null;
  athDate: string | null;
  /** % below the ATH (85 = 85% below). */
  belowAthPct: number | null;
  /** Last funding rate in % (0.01 = 0.01%). */
  fundingRatePct: number | null;
  /** 1 | 4 | 8 — Binance funding settlement interval. */
  fundingIntervalHours: number;
  nextFundingTime: number | null;
  ecosystems: string[];
  monitoring: boolean;
  onSpot: boolean;
  spotListedAt: string | null;
  futuresListedAt: string | null;
};

export type JunkCoinStatsResponse = { updatedAt: string; stats: JunkCoinStat[] };

export type SyncJunkCoinsResult = {
  scanned: number;
  junk: number;
  added: string[];
  /** Synced coins that no longer pass the junk gates (kept — the user decides). */
  noLongerJunk: string[];
  coins: JunkShortCoin[];
};

export type TradingListWatchlistSymbol = {
  symbol: string;
  /** Set when only one exchange has a USDT-M contract for the coin; null = both. */
  onlyExchange: TradingExchange | null;
  createdAt: string;
};

/** A Spot Analytic strategy (GET /tracking-coins/strategies; source: packages/skills tracking-swing/strategies.ts). */
export type SpotStrategy = {
  id: string;
  name: string;
  status: 'active' | 'draft' | 'retired';
  createdAt: string;
  summary: string;
  target: string;
  rules: Array<{ title: string; items: string[] }>;
  backtest: {
    period: string;
    universe: string;
    method: string;
    columns?: [string, string];
    rows: Array<{ config: string; cagr: string; maxDd: string; note?: string }>;
    takeaways: string[];
  };
  lessons: string[];
  limits: string[];
  sources: string[];
};

/** In-app notification (bell + /notifications). Written by the worker; also pushed to Telegram. */
export type AppNotification = {
  id: string;
  /** order_filled = a Bitget/MEXC futures order filled. */
  type: 'order_filled' | string;
  exchange: TradingExchange | null;
  symbol: string | null;
  title: string;
  body: string;
  payload: {
    orderId?: string;
    side?: 'long' | 'short' | null;
    action?: 'open' | 'close' | 'liquidation' | 'unknown';
    phase?: 'new' | 'dca' | 'partial_close' | 'full_close' | null;
    kind?: 'tp' | 'sl' | 'liquidation' | null;
    orderType?: string | null;
    price?: number;
    size?: number;
    quote?: number;
    profit?: number;
    fee?: number;
    revision?: number;
    fillCount?: number;
  } | null;
  eventAt: string;
  readAt: string | null;
  telegramSent: boolean;
  createdAt: string;
};

export type NotificationPage = { items: AppNotification[]; nextCursor: string | null };

/** Daily rule-based Strategy A / B scan of the /tracking-coins watchlist. */
/** Daily (07:02 VN) setup A / B scan of the /short-junk list. */
export type JunkShortDailyScan = {
  scannedAt: string;
  trigger: 'CRON' | 'MANUAL';
  btc: { bear: boolean; close: number; ema50: number };
  short: Array<{
    symbol: string;
    setup: 'A' | 'B';
    action: 'SHORT' | 'HALF' | 'WATCH';
    pump3dPct: number;
    price: number;
    entries: number[];
    stop: number;
    tpPct: number;
    days: number;
    flags: string[];
  }>;
  watch: Array<{ symbol: string; pump3dPct: number }>;
  coins: number;
  notOnFutures: string[];
};

export type SpotDailyScan = {
  scannedAt: string;
  trigger: 'CRON' | 'MANUAL';
  breadthPct: number | null;
  /** BUY = breadth ≥ 25% · TOP50 = 10–25% (volRank ≤ 50 only) · NONE = < 10% (no new A entries). */
  regime: 'BUY' | 'TOP50' | 'NONE' | 'UNKNOWN';
  marketB: boolean;
  a: Array<{ symbol: string; rsiW: number; volRank: number; price: number; buy: [number, number, number] }>;
  b: Array<{
    symbol: string;
    level: 'B' | 'B+';
    grade: 'CLIMAX' | 'RÂU' | 'THƯỜNG';
    entry: number;
    maxEntry: number;
    tp: number;
    tpPct: number;
    sellBy: string;
    price: number;
  }>;
  coins: number;
  failed: string[];
};
