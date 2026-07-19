import type {
  BackTestResult,
  BackTestResultRecord,
  BackTestStrategy,
  CloseDashboardOrderInput,
  CoinTransaction,
  CreateDashboardOrderInput,
  CreatePortfolioInput,
  CreateTransactionInput,
  CreateTradingStrategyInput,
  DailyAnalysis,
  DashboardAnalysisRun,
  DashboardHealth,
  DashboardOrder,
  DashboardSignal,
  Holding,
  OrderFilterParams,
  PaginatedOrders,
  PnlSnapshot,
  Portfolio,
  PortfolioPnlCalendar,
  QueryPnlInput,
  QueryTransactionsInput,
  RunBackTestInput,
  Skill,
  TrackedSetup,
  TrackingSettings,
  TradingStrategy,
  UpdateDashboardOrderInput,
  UpdatePortfolioInput,
  UpdateTradingStrategyInput,
  UpsertSettingsInput,
  UserProfile,
  Conversation,
  ChatMessage,
  SmallCapCoinRow,
  SmallCapHistoryRow,
  MemeCoinRow,
  MemeHistoryRow,
  PatternKind,
  PatternWatchCoin,
  PatternScanResult,
  PatternReferenceImage,
  EmaBounceCoin,
  EmaBounceSignal,
  EmaBouncePreview,
  TradingJournalEntry,
  TradingJournalRevision,
  TrackingCoinRow,
  OrderSuggestions,
  TrackingCoinOrder,
  SignalHistoryRow,
  DcaPosition,
  BitgetPositionsResponse,
  BitgetHistoryResponse,
  BitgetJournalNote,
  BitgetJournalSnapshot,
  BinanceKline,
  ImageRef,
} from './types';


type JsonRecord = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
};

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

function readConfiguredBaseUrl(): string {
  // Server-side (SSR/RSC): talk to API directly on localhost — no browser involved
  if (typeof window === 'undefined') {
    return process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
  }
  // Client-side browser: use the public URL baked in at build time.
  // In production this points to /api-proxy on the web server (port 3001),
  // which Next.js rewrites forward to the API on localhost:3000.
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export function resolveApiBaseUrl(path = ''): string {
  const baseUrl = readConfiguredBaseUrl().replace(/\/+$/, '');

  if (!path) {
    return baseUrl;
  }

  return new URL(path.startsWith('/') ? path : `/${path}`, `${baseUrl}/`).toString().replace(
    /\/$/,
    ''
  );
}

function parseDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function parseOptionalDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  return parseDate(value);
}

function parseJsonArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed)
      ? parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];
  } catch {
    return [];
  }
}

async function fetchJson<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const response = await fetchImpl(url, init);

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

function mapOrder(row: JsonRecord): DashboardOrder {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    side: String(row.side),
    status: String(row.status),
    entryPrice: Number(row.entryPrice),
    openedAt: parseDate(row.openedAt),
    closedAt: parseOptionalDate(row.closedAt),
    createdAt: parseDate(row.createdAt),
    updatedAt: parseDate(row.updatedAt),
    closePrice: row.closePrice == null ? null : Number(row.closePrice),
    pnl: row.pnl == null ? null : Number(row.pnl),
    quantity: row.quantity == null ? null : Number(row.quantity),
    leverage: row.leverage == null ? null : Number(row.leverage),
    note: row.note == null ? null : String(row.note),
    images: Array.isArray(row.images) ? (row.images as unknown[]).map(String) : [],
    source: row.source == null ? undefined : String(row.source),
    exchange: row.exchange == null ? null : String(row.exchange),
    broker: row.broker == null ? null : String(row.broker),
    orderType: row.orderType == null ? null : String(row.orderType),
    signalId: row.signalId == null ? null : String(row.signalId)
  };
}

function mapSignal(row: JsonRecord): DashboardSignal {
  return {
    id: String(row.id),
    analysisRunId: String(row.analysisRunId),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    trend: String(row.trend),
    bias: String(row.bias),
    confidence: Number(row.confidence),
    summary: String(row.summary),
    supportLevels: parseJsonArray(row.supportLevelsJson ?? row.supportLevels),
    resistanceLevels: parseJsonArray(row.resistanceLevelsJson ?? row.resistanceLevels),
    invalidation: String(row.invalidation),
    bullishScenario: String(row.bullishScenario),
    bearishScenario: String(row.bearishScenario),
    createdAt: parseDate(row.createdAt)
  };
}

function mapAnalysisRun(row: JsonRecord): DashboardAnalysisRun {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    candleOpenTime: parseDate(row.candleOpenTime),
    candleCloseTime: parseDate(row.candleCloseTime),
    priceOpen: Number(row.priceOpen),
    priceHigh: Number(row.priceHigh),
    priceLow: Number(row.priceLow),
    priceClose: Number(row.priceClose),
    rawIndicatorsJson: String(row.rawIndicatorsJson ?? ''),
    llmInputJson: String(row.llmInputJson ?? ''),
    llmOutputJson: String(row.llmOutputJson ?? ''),
    status: String(row.status),
    errorMessage: row.errorMessage == null ? null : String(row.errorMessage),
    createdAt: parseDate(row.createdAt),
    updatedAt: parseDate(row.updatedAt)
  };
}

function mapDailyAnalysis(row: JsonRecord): DailyAnalysis {
  const aiOutput =
    row.aiOutput && typeof row.aiOutput === 'object' && row.aiOutput !== null
      ? (row.aiOutput as DailyAnalysis['aiOutput'])
      : row.aiOutputJson && typeof row.aiOutputJson === 'string'
      ? (JSON.parse(row.aiOutputJson) as DailyAnalysis['aiOutput'])
      : ({} as DailyAnalysis['aiOutput']);

  return {
    aiOutput,
    id: String(row.id),
    symbol: String(row.symbol),
    date: String(row.date),
    status: String(row.status ?? 'WAIT') as DailyAnalysis['status'],
    d1Trend: row.d1Trend != null ? (String(row.d1Trend) as 'bullish' | 'bearish' | 'neutral') : null,
    h4Trend: row.h4Trend != null ? (String(row.h4Trend) as 'bullish' | 'bearish' | 'neutral') : null,
    d1S1: row.d1S1 != null ? Number(row.d1S1) : null,
    d1S2: row.d1S2 != null ? Number(row.d1S2) : null,
    d1R1: row.d1R1 != null ? Number(row.d1R1) : null,
    d1R2: row.d1R2 != null ? Number(row.d1R2) : null,
    h4S1: row.h4S1 != null ? Number(row.h4S1) : null,
    h4S2: row.h4S2 != null ? Number(row.h4S2) : null,
    h4R1: row.h4R1 != null ? Number(row.h4R1) : null,
    h4R2: row.h4R2 != null ? Number(row.h4R2) : null,
    llmProvider: String(row.llmProvider ?? ''),
    llmModel: String(row.llmModel ?? ''),
    pipelineDebugJson:
      row.pipelineDebugJson == null ? null : String(row.pipelineDebugJson),
    summary: String(row.summary ?? ''),
    feedbackScore: row.feedbackScore == null ? null : Number(row.feedbackScore),
    feedbackNote: row.feedbackNote == null ? null : String(row.feedbackNote),
    createdAt: String(row.createdAt)
  };
}

function mapTrackedSetup(row: JsonRecord): TrackedSetup {
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  const str = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    id: String(row.id),
    dailyAnalysisId: String(row.dailyAnalysisId),
    symbol: String(row.symbol),
    planDate: String(row.planDate),
    slot: String(row.slot) as TrackedSetup['slot'],
    direction: String(row.direction) as TrackedSetup['direction'],
    entryLow: Number(row.entryLow),
    entryHigh: Number(row.entryHigh),
    stopLoss: Number(row.stopLoss),
    takeProfit1: num(row.takeProfit1),
    takeProfit2: num(row.takeProfit2),
    status: String(row.status ?? 'PENDING') as TrackedSetup['status'],
    enteredAt: str(row.enteredAt),
    tp1HitAt: str(row.tp1HitAt),
    tp2HitAt: str(row.tp2HitAt),
    slHitAt: str(row.slHitAt),
    closedAt: str(row.closedAt),
    invalidatedReason: str(row.invalidatedReason),
    notes: str(row.notes),
    lastPrice: num(row.lastPrice),
    lastCheckedAt: str(row.lastCheckedAt)
  };
}

function mapSettings(row: JsonRecord): TrackingSettings {
  const symbols = Array.isArray(row.trackingSymbols)
    ? (row.trackingSymbols as unknown[]).map(String)
    : [];
  return {
    id: String(row.id),
    name: String(row.name),
    trackingSymbols: symbols,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function mapTradingStrategy(row: JsonRecord): TradingStrategy {
  const imageReference = Array.isArray(row.imageReference)
    ? (row.imageReference as unknown[]).map(String)
    : [];
  return {
    id: String(row.id),
    name: String(row.name),
    content: String(row.content),
    imageReference,
    version: String(row.version),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function mapPortfolio(row: JsonRecord): Portfolio {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    totalCapital: row.totalCapital == null ? null : Number(row.totalCapital),
    userId: String(row.userId),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function mapTransaction(row: JsonRecord): CoinTransaction {
  return {
    id: String(row.id),
    portfolioId: String(row.portfolioId),
    coinId: String(row.coinId),
    type: String(row.type) as 'buy' | 'sell',
    amount: Number(row.amount),
    price: Number(row.price),
    totalValue: Number(row.totalValue),
    fee: row.fee == null ? 0 : Number(row.fee),
    note: row.note == null ? null : String(row.note),
    images: Array.isArray(row.images) ? (row.images as unknown[]).map(String) : [],
    transactedAt: String(row.transactedAt),
    deletedAt: row.deletedAt == null ? null : String(row.deletedAt),
    createdAt: String(row.createdAt)
  };
}

function mapHolding(row: JsonRecord): Holding {
  return {
    portfolioId: String(row.portfolioId),
    coinId: String(row.coinId),
    totalAmount: Number(row.totalAmount),
    avgCost: Number(row.avgCost),
    totalInvested: Number(row.totalCost ?? row.totalInvested),
    realizedPnl: Number(row.realizedPnl),
    note: row.note == null ? null : String(row.note)
  };
}

function mapPnlSnapshot(row: JsonRecord): PnlSnapshot {
  return {
    id: String(row.id),
    portfolioId: String(row.portfolioId),
    coinId: row.coinId == null ? null : String(row.coinId),
    date: String(row.date),
    unrealizedPnl: Number(row.unrealizedPnl),
    totalValue: Number(row.totalValue)
  };
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? readConfiguredBaseUrl()).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const defaultHeaders = new Headers(options.headers);
  const defaultCredentials = options.credentials ?? 'include';

  if (!fetchImpl) {
    throw new Error('No fetch implementation available');
  }

  function withDefaults(init: RequestInit = {}): RequestInit {
    const headers = new Headers(defaultHeaders);
    const requestHeaders = new Headers(init.headers);

    requestHeaders.forEach((value, key) => {
      headers.set(key, value);
    });

    return {
      ...init,
      headers,
      credentials: init.credentials ?? defaultCredentials
    };
  }

  return {
    baseUrl,
    async uploadImages(files: File[], symbol?: string, side?: string): Promise<string[]> {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      const params = new URLSearchParams();
      if (symbol) params.set('symbol', symbol);
      if (side) params.set('side', side);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const response = await fetchImpl(`${baseUrl}/upload/images${qs}`, {
        ...withDefaults({ method: 'POST' }),
        body: formData
      });
      if (!response.ok) {
        throw new Error(`Image upload failed: ${response.status}`);
      }
      const data = (await response.json()) as { urls: string[] };
      return data.urls;
    },
    async uploadImagesR2(files: File[]): Promise<ImageRef[]> {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      const response = await fetchImpl(`${baseUrl}/uploads/images`, {
        ...withDefaults({ method: 'POST' }),
        body: formData
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Image upload failed: ${response.status}${text ? ` — ${text}` : ''}`);
      }
      return (await response.json()) as ImageRef[];
    },
    async fetchOrders(params?: OrderFilterParams): Promise<PaginatedOrders> {
      const qs = new URLSearchParams();
      if (params?.symbol) qs.set('symbol', params.symbol);
      if (params?.status) qs.set('status', params.status);
      if (params?.broker) qs.set('broker', params.broker);
      if (params?.dateFrom) qs.set('dateFrom', params.dateFrom);
      if (params?.dateTo) qs.set('dateTo', params.dateTo);
      if (params?.page != null) qs.set('page', String(params.page));
      if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
      const query = qs.toString();
      const url = query ? `${baseUrl}/orders?${query}` : `${baseUrl}/orders`;
      const result = await fetchJson<{
        data: JsonRecord[];
        total: number;
        page: number;
        pageSize: number;
        closedPnlSum: number;
        openOrders: JsonRecord[];
      }>(fetchImpl, url, withDefaults());
      return {
        data: result.data.map(mapOrder),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        closedPnlSum: result.closedPnlSum,
        openOrders: result.openOrders.map(mapOrder),
      };
    },
    async fetchOrderBrokers(): Promise<string[]> {
      return fetchJson<string[]>(fetchImpl, `${baseUrl}/orders/brokers`, withDefaults());
    },
    async fetchSignals(): Promise<DashboardSignal[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/signals`, withDefaults());
      return rows.map(mapSignal);
    },
    async fetchAnalysisRuns(): Promise<DashboardAnalysisRun[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/analysis-runs`, withDefaults());
      return rows.map(mapAnalysisRun);
    },
    async fetchHealth(): Promise<DashboardHealth> {
      return fetchJson<DashboardHealth>(fetchImpl, `${baseUrl}/health`, withDefaults());
    },
    async fetchDailyAnalysis(symbol?: string): Promise<DailyAnalysis[]> {
      const url = symbol
        ? `${baseUrl}/daily-analysis?symbol=${symbol}`
        : `${baseUrl}/daily-analysis`;
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, url, withDefaults());
      return rows.map(mapDailyAnalysis);
    },
    async fetchTrackedSetups(symbol?: string): Promise<TrackedSetup[]> {
      const url = symbol
        ? `${baseUrl}/tracked-setups?symbol=${encodeURIComponent(symbol)}`
        : `${baseUrl}/tracked-setups`;
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, url, withDefaults());
      return rows.map(mapTrackedSetup);
    },
    async fetchTrackedSetupsByPlans(ids: string[]): Promise<TrackedSetup[]> {
      if (ids.length === 0) return [];
      const url = `${baseUrl}/tracked-setups/by-plans?ids=${encodeURIComponent(ids.join(','))}`;
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, url, withDefaults());
      return rows.map(mapTrackedSetup);
    },
    async updateTrackedSetupNotes(id: string, notes: string | null): Promise<TrackedSetup> {
      const response = await fetchImpl(`${baseUrl}/tracked-setups/${id}/notes`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      }));
      if (!response.ok) {
        throw new Error(`Failed to update tracked setup notes: ${response.status}`);
      }
      return mapTrackedSetup((await response.json()) as JsonRecord);
    },
    async updateDailyAnalysisFeedback(id: string, score: number, note?: string): Promise<DailyAnalysis> {
      const response = await fetchImpl(`${baseUrl}/daily-analysis/${id}/feedback`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, note })
      }));
      if (!response.ok) throw new Error(`Failed to update feedback: ${response.status}`);
      return mapDailyAnalysis((await response.json()) as JsonRecord);
    },
    async createOrder(input: CreateDashboardOrderInput): Promise<DashboardOrder> {
      const response = await fetchImpl(`${baseUrl}/orders`, withDefaults({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      }));

      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/orders: ${response.status}`);
      }

      return mapOrder((await response.json()) as JsonRecord);
    },
    async updateOrder(orderId: string, input: UpdateDashboardOrderInput): Promise<DashboardOrder> {
      const response = await fetchImpl(`${baseUrl}/orders/${orderId}`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));

      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/orders/${orderId}: ${response.status}`);
      }

      return mapOrder((await response.json()) as JsonRecord);
    },
    async deleteOrder(orderId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/orders/${orderId}`, withDefaults({ method: 'DELETE' }));

      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/orders/${orderId}: ${response.status}`);
      }
    },
    async closeOrder(orderId: string, input: CloseDashboardOrderInput): Promise<DashboardOrder> {
      const response = await fetchImpl(`${baseUrl}/orders/${orderId}/close`, withDefaults({
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      }));

      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/orders/${orderId}/close: ${response.status}`);
      }

      return mapOrder((await response.json()) as JsonRecord);
    },
    async fetchSettings(): Promise<TrackingSettings | null> {
      const row = await fetchJson<JsonRecord | null>(fetchImpl, `${baseUrl}/settings`, withDefaults());
      return row ? mapSettings(row) : null;
    },
    async upsertSettings(input: UpsertSettingsInput): Promise<TrackingSettings> {
      const response = await fetchImpl(`${baseUrl}/settings`, withDefaults({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/settings: ${response.status}`);
      }
      return mapSettings((await response.json()) as JsonRecord);
    },
    async fetchBackTestStrategies(): Promise<BackTestStrategy[]> {
      return fetchJson<BackTestStrategy[]>(fetchImpl, `${baseUrl}/back-test/strategies`, withDefaults());
    },
    async runBackTest(input: RunBackTestInput): Promise<BackTestResult> {
      const response = await fetchImpl(`${baseUrl}/back-test/run`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/back-test/run: ${response.status}`);
      }
      return (await response.json()) as BackTestResult;
    },
    async fetchBackTestResults(strategy?: string, symbol?: string): Promise<BackTestResultRecord[]> {
      const params = new URLSearchParams();
      if (strategy) params.set('strategy', strategy);
      if (symbol) params.set('symbol', symbol);
      const query = params.toString() ? `?${params.toString()}` : '';
      return fetchJson<BackTestResultRecord[]>(fetchImpl, `${baseUrl}/back-test/results${query}`, withDefaults());
    },
    async fetchBackTestResult(id: string): Promise<BackTestResult> {
      return fetchJson<BackTestResult>(fetchImpl, `${baseUrl}/back-test/results/${id}`, withDefaults());
    },
    async deleteBackTestResult(id: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/back-test/results/${id}`, withDefaults({ method: 'DELETE' }));
      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/back-test/results/${id}: ${response.status}`);
      }
    },
    async fetchTradingStrategies(): Promise<TradingStrategy[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/strategies`, withDefaults());
      return rows.map(mapTradingStrategy);
    },
    async fetchTradingStrategyById(id: string): Promise<TradingStrategy> {
      const row = await fetchJson<JsonRecord>(fetchImpl, `${baseUrl}/strategies/${id}`, withDefaults());
      return mapTradingStrategy(row);
    },
    async createTradingStrategy(input: CreateTradingStrategyInput): Promise<TradingStrategy> {
      const response = await fetchImpl(`${baseUrl}/strategies`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/strategies: ${response.status}`);
      }
      return mapTradingStrategy((await response.json()) as JsonRecord);
    },
    async updateTradingStrategy(id: string, input: UpdateTradingStrategyInput): Promise<TradingStrategy> {
      const response = await fetchImpl(`${baseUrl}/strategies/${id}`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/strategies/${id}: ${response.status}`);
      }
      return mapTradingStrategy((await response.json()) as JsonRecord);
    },
    async deleteTradingStrategy(id: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/strategies/${id}`, withDefaults({ method: 'DELETE' }));
      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/strategies/${id}: ${response.status}`);
      }
    },
    async fetchPortfolios(): Promise<Portfolio[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/portfolios`, withDefaults());
      return rows.map(mapPortfolio);
    },
    async fetchPortfolio(id: string): Promise<Portfolio> {
      const row = await fetchJson<JsonRecord>(fetchImpl, `${baseUrl}/portfolios/${id}`, withDefaults());
      return mapPortfolio(row);
    },
    async createPortfolio(input: CreatePortfolioInput): Promise<Portfolio> {
      const response = await fetchImpl(`${baseUrl}/portfolios`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/portfolios: ${response.status}`);
      return mapPortfolio((await response.json()) as JsonRecord);
    },
    async updatePortfolio(id: string, input: UpdatePortfolioInput): Promise<Portfolio> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${id}`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/portfolios/${id}: ${response.status}`);
      return mapPortfolio((await response.json()) as JsonRecord);
    },
    async deletePortfolio(id: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${id}`, withDefaults({ method: 'DELETE' }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/portfolios/${id}: ${response.status}`);
    },
    async fetchTransactions(portfolioId: string, query?: QueryTransactionsInput): Promise<CoinTransaction[]> {
      const params = new URLSearchParams();
      if (query?.coinId) params.set('coinId', query.coinId);
      if (query?.type) params.set('type', query.type);
      if (query?.from) params.set('from', query.from);
      if (query?.to) params.set('to', query.to);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/portfolios/${portfolioId}/transactions${qs}`, withDefaults());
      return rows.map(mapTransaction);
    },
    async createTransaction(portfolioId: string, input: CreateTransactionInput): Promise<CoinTransaction> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${portfolioId}/transactions`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/portfolios/${portfolioId}/transactions: ${response.status}`);
      return mapTransaction((await response.json()) as JsonRecord);
    },
    async updateTransaction(portfolioId: string, id: string, input: { type?: 'buy' | 'sell'; price?: number; amount?: number; fee?: number; note?: string | null; images?: string[] | null; transactedAt?: string }): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${portfolioId}/transactions/${id}`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) throw new Error(`Failed to update transaction: ${response.status}`);
    },
    async deleteTransaction(portfolioId: string, id: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${portfolioId}/transactions/${id}`, withDefaults({ method: 'DELETE' }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/portfolios/${portfolioId}/transactions/${id}: ${response.status}`);
    },
    async fetchHoldings(portfolioId: string, prices?: Record<string, number>): Promise<Holding[]> {
      const params = new URLSearchParams();
      if (prices) params.set('prices', JSON.stringify(prices));
      const qs = params.toString() ? `?${params.toString()}` : '';
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/portfolios/${portfolioId}/holdings${qs}`, withDefaults());
      return rows.map(mapHolding);
    },
    async updateHoldingNote(portfolioId: string, coinId: string, note: string | null): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${portfolioId}/holdings/${coinId}/note`, withDefaults({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) }));
      if (!response.ok) throw new Error(`Failed to update holding note: ${response.status}`);
    },
    async recalculateHoldings(portfolioId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${portfolioId}/holdings/recalculate`, withDefaults({ method: 'POST' }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/portfolios/${portfolioId}/holdings/recalculate: ${response.status}`);
    },
    async transferHolding(portfolioId: string, coinId: string, targetPortfolioId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${portfolioId}/holdings/${coinId}/transfer`, withDefaults({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetPortfolioId }) }));
      if (!response.ok) throw new Error(`Failed to transfer ${coinId}: ${response.status}`);
    },
    async fetchPnlHistory(portfolioId: string, query?: QueryPnlInput): Promise<PnlSnapshot[]> {
      const params = new URLSearchParams();
      if (query?.from) params.set('from', query.from);
      if (query?.to) params.set('to', query.to);
      if (query?.coinId) params.set('coinId', query.coinId);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/portfolios/${portfolioId}/pnl${qs}`, withDefaults());
      return rows.map(mapPnlSnapshot);
    },
    async fetchPortfolioPnlCalendar(): Promise<PortfolioPnlCalendar> {
      const raw = await fetchJson<{ daily: JsonRecord[]; byCoin: JsonRecord[] }>(
        fetchImpl, `${baseUrl}/portfolios/pnl-calendar`, withDefaults()
      );
      return {
        daily: raw.daily.map((r) => ({ date: String(r['date']), realizedPnl: Number(r['realizedPnl']) })),
        byCoin: raw.byCoin.map((r) => ({ coinId: String(r['coinId']), realizedPnl: Number(r['realizedPnl']) }))
      };
    },
    async login(input: { email: string; password: string }) {
      const response = await fetchImpl(`${baseUrl}/auth/login`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));

      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/auth/login: ${response.status}`);
      }

      return (await response.json()) as { user: { id: string; email: string; name: string } };
    },
    async fetchUserProfile(): Promise<UserProfile> {
      const row = await fetchJson<JsonRecord>(fetchImpl, `${baseUrl}/user/profile`, withDefaults());
      return {
        id: String(row.id),
        email: String(row.email),
        name: String(row.name),
        symbolsTracking: Array.isArray(row.symbolsTracking) ? (row.symbolsTracking as unknown[]).map(String) : [],
        dailySignalWatchlist: Array.isArray(row.dailySignalWatchlist) ? (row.dailySignalWatchlist as unknown[]).map(String) : [],
      };
    },
    async updateUserProfile(input: { name?: string; symbolsTracking?: string[]; dailySignalWatchlist?: string[] }): Promise<UserProfile> {
      const response = await fetchImpl(`${baseUrl}/user/profile`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/user/profile: ${response.status}`);
      }
      const row = (await response.json()) as JsonRecord;
      return {
        id: String(row.id),
        email: String(row.email),
        name: String(row.name),
        symbolsTracking: Array.isArray(row.symbolsTracking) ? (row.symbolsTracking as unknown[]).map(String) : [],
        dailySignalWatchlist: Array.isArray(row.dailySignalWatchlist) ? (row.dailySignalWatchlist as unknown[]).map(String) : [],
      };
    },

    // ── Tracking Coins ────────────────────────────────────────────────
    fetchOrderSuggestions(symbol: string): Promise<OrderSuggestions> {
      return fetchJson<OrderSuggestions>(fetchImpl, `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/order-suggestions`, withDefaults());
    },

    fetchCoinOrders(symbol: string): Promise<TrackingCoinOrder[]> {
      return fetchJson<TrackingCoinOrder[]>(fetchImpl, `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/orders`, withDefaults());
    },

    fetchCoinKlines(symbol: string, interval: string, limit: number): Promise<BinanceKline[]> {
      return fetchJson<BinanceKline[]>(
        fetchImpl,
        `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/klines?interval=${encodeURIComponent(interval)}&limit=${limit}`,
        withDefaults(),
      );
    },

    fetchDcaPosition(symbol: string): Promise<DcaPosition> {
      return fetchJson<DcaPosition>(fetchImpl, `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/dca-position`, withDefaults());
    },

    fetchSignalHistory(symbol: string, limit = 100): Promise<SignalHistoryRow[]> {
      return fetchJson<SignalHistoryRow[]>(
        fetchImpl,
        `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/signal-history?limit=${limit}`,
        withDefaults(),
      );
    },

    addDcaBuy(symbol: string, body: { price: number; usd: number; boughtAt?: string; portfolioId?: string }): Promise<DcaPosition> {
      return fetchJson<DcaPosition>(fetchImpl, `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/dca-buys`, {
        ...withDefaults(),
        method: 'POST',
        headers: { ...withDefaults().headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },

    deleteDcaBuy(symbol: string, buyId: string): Promise<DcaPosition> {
      return fetchJson<DcaPosition>(fetchImpl, `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/dca-buys/${encodeURIComponent(buyId)}`, {
        ...withDefaults(),
        method: 'DELETE',
      });
    },

    closeDcaPosition(symbol: string, sellPrice?: number): Promise<DcaPosition> {
      const qs = sellPrice != null && sellPrice > 0 ? `?sellPrice=${encodeURIComponent(String(sellPrice))}` : '';
      return fetchJson<DcaPosition>(fetchImpl, `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/dca-position${qs}`, {
        ...withDefaults(),
        method: 'DELETE',
      });
    },

    updateOrderNotes(orderId: string, notes: string | null): Promise<void> {
      return fetchImpl(`${baseUrl}/tracking-coins/coins/orders/${encodeURIComponent(orderId)}/notes`, {
        ...withDefaults(),
        method: 'PATCH',
        headers: { ...withDefaults().headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      }).then(() => undefined);
    },

    // ── Skills ────────────────────────────────────────────────────────
    fetchSkills(): Promise<Skill[]> {
      return fetchJson<Skill[]>(fetchImpl, `${baseUrl}/skills`, withDefaults());
    },

    // ── Chat / Conversations ──────────────────────────────────────────
    listConversations(skillId?: string): Promise<Conversation[]> {
      const url = skillId
        ? `${baseUrl}/chat/conversations?skillId=${encodeURIComponent(skillId)}`
        : `${baseUrl}/chat/conversations`;
      return fetchJson<Conversation[]>(fetchImpl, url, withDefaults());
    },
    async createConversation(title?: string, skillId?: string, coinId?: string, portfolioId?: string): Promise<Conversation> {
      const res = await fetchImpl(`${baseUrl}/chat/conversations`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, skillId, coinId, portfolioId })
      }));
      if (!res.ok) throw new Error(`createConversation failed: ${res.status}`);
      return res.json() as Promise<Conversation>;
    },
    async deleteConversation(id: string): Promise<void> {
      await fetchImpl(`${baseUrl}/chat/conversations/${id}`, withDefaults({ method: 'DELETE' }));
    },
    async generateTitle(conversationId: string): Promise<{ title: string }> {
      const res = await fetchImpl(`${baseUrl}/chat/conversations/${conversationId}/title/generate`, withDefaults({ method: 'POST' }));
      if (!res.ok) throw new Error(`generateTitle failed: ${res.status}`);
      return res.json() as Promise<{ title: string }>;
    },
    async updateConversationTitle(id: string, title: string): Promise<Conversation> {
      const res = await fetchImpl(`${baseUrl}/chat/conversations/${id}/title`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      }));
      if (!res.ok) throw new Error(`updateConversationTitle failed: ${res.status}`);
      return res.json() as Promise<Conversation>;
    },
    getMessages(conversationId: string): Promise<ChatMessage[]> {
      return fetchJson<ChatMessage[]>(fetchImpl, `${baseUrl}/chat/conversations/${conversationId}/messages`, withDefaults());
    },
    async sendMessage(conversationId: string, content: string): Promise<ChatMessage> {
      const res = await fetchImpl(`${baseUrl}/chat/conversations/${conversationId}/messages`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      }));
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? `sendMessage failed: ${res.status}`);
      }
      return res.json() as Promise<ChatMessage>;
    },

    async fetchSmallCapRadar(): Promise<SmallCapCoinRow[]> {
      return fetchJson<SmallCapCoinRow[]>(fetchImpl, `${baseUrl}/small-cap-radar`, withDefaults());
    },

    async addSmallCapCoin(symbol: string, name?: string): Promise<{ id: string; symbol: string; name: string }> {
      return fetchJson<{ id: string; symbol: string; name: string }>(
        fetchImpl,
        `${baseUrl}/small-cap-radar/coins`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, name }),
        }),
      );
    },

    async removeSmallCapCoin(symbol: string): Promise<void> {
      await fetchImpl(`${baseUrl}/small-cap-radar/coins/${encodeURIComponent(symbol)}`, withDefaults({ method: 'DELETE' }));
    },

    fetchSmallCapSignalHistory(symbol: string, limit = 100): Promise<SmallCapHistoryRow[]> {
      return fetchJson<SmallCapHistoryRow[]>(
        fetchImpl,
        `${baseUrl}/small-cap-radar/coins/${encodeURIComponent(symbol)}/signal-history?limit=${limit}`,
        withDefaults(),
      );
    },

    async triggerSmallCapScan(): Promise<{ scanned: number; failed: number }> {
      return fetchJson<{ scanned: number; failed: number }>(
        fetchImpl,
        `${baseUrl}/small-cap-radar/scan`,
        withDefaults({ method: 'POST' }),
      );
    },

    // ── Pattern Scanner ──────────────────────────────────────────────
    async fetchPatternCoins(): Promise<PatternWatchCoin[]> {
      return fetchJson<PatternWatchCoin[]>(fetchImpl, `${baseUrl}/pattern-scanner/coins`, withDefaults());
    },

    async addPatternCoin(symbol: string, name?: string): Promise<PatternWatchCoin> {
      return fetchJson<PatternWatchCoin>(
        fetchImpl,
        `${baseUrl}/pattern-scanner/coins`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, name }),
        }),
      );
    },

    async removePatternCoin(symbol: string): Promise<void> {
      await fetchImpl(`${baseUrl}/pattern-scanner/coins/${encodeURIComponent(symbol)}`, withDefaults({ method: 'DELETE' }));
    },

    async scanPatterns(patterns: PatternKind[], timeframe: string): Promise<PatternScanResult> {
      return fetchJson<PatternScanResult>(
        fetchImpl,
        `${baseUrl}/pattern-scanner/scan`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patterns, timeframe }),
        }),
      );
    },

    async fetchPatternReferences(pattern: PatternKind | string): Promise<PatternReferenceImage[]> {
      return fetchJson<PatternReferenceImage[]>(fetchImpl, `${baseUrl}/pattern-scanner/references/${encodeURIComponent(pattern)}`, withDefaults());
    },

    async uploadPatternReference(pattern: PatternKind | string, file: File, notes?: string): Promise<PatternReferenceImage> {
      const form = new FormData();
      form.append('file', file);
      form.append('pattern', pattern);
      if (notes) form.append('notes', notes);
      return fetchJson<PatternReferenceImage>(
        fetchImpl,
        `${baseUrl}/pattern-scanner/references/upload`,
        withDefaults({ method: 'POST', body: form }),
      );
    },

    async removePatternReference(id: string): Promise<void> {
      await fetchImpl(`${baseUrl}/pattern-scanner/references/${encodeURIComponent(id)}`, withDefaults({ method: 'DELETE' }));
    },

    // ── EMA Bounce Scanner ──────────────────────────────────────
    async fetchEmaBounceCoins(): Promise<EmaBounceCoin[]> {
      return fetchJson<EmaBounceCoin[]>(fetchImpl, `${baseUrl}/ema-bounce/coins`, withDefaults());
    },

    async addEmaBounceCoin(symbol: string, name?: string): Promise<EmaBounceCoin> {
      return fetchJson<EmaBounceCoin>(
        fetchImpl,
        `${baseUrl}/ema-bounce/coins`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, name }),
        }),
      );
    },

    async removeEmaBounceCoin(symbol: string): Promise<void> {
      await fetchImpl(`${baseUrl}/ema-bounce/coins/${encodeURIComponent(symbol)}`, withDefaults({ method: 'DELETE' }));
    },

    async fetchEmaBounceSignals(onlyOpen = false): Promise<EmaBounceSignal[]> {
      const qs = onlyOpen ? '?open=true' : '';
      return fetchJson<EmaBounceSignal[]>(fetchImpl, `${baseUrl}/ema-bounce/signals${qs}`, withDefaults());
    },

    async previewEmaBounce(): Promise<EmaBouncePreview> {
      return fetchJson<EmaBouncePreview>(fetchImpl, `${baseUrl}/ema-bounce/preview`, withDefaults({ method: 'POST' }));
    },

    // ── Trading Journal ─────────────────────────────────────────
    async fetchJournalEntries(): Promise<TradingJournalEntry[]> {
      return fetchJson<TradingJournalEntry[]>(fetchImpl, `${baseUrl}/journal`, withDefaults());
    },

    async saveJournalEntry(input: { date: string; content: string; images: string[]; tags: string[] }): Promise<TradingJournalEntry> {
      return fetchJson<TradingJournalEntry>(
        fetchImpl,
        `${baseUrl}/journal`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
    },

    async fetchJournalRevisions(entryId: string): Promise<TradingJournalRevision[]> {
      return fetchJson<TradingJournalRevision[]>(
        fetchImpl,
        `${baseUrl}/journal/${encodeURIComponent(entryId)}/revisions`,
        withDefaults(),
      );
    },

    async deleteJournalEntry(id: string): Promise<void> {
      await fetchImpl(`${baseUrl}/journal/${encodeURIComponent(id)}`, withDefaults({ method: 'DELETE' }));
    },

    async reformatJournal(content: string): Promise<string> {
      const res = await fetchJson<{ content: string }>(
        fetchImpl,
        `${baseUrl}/journal/reformat`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        }),
      );
      return res.content;
    },

    async fetchMemeRadar(): Promise<MemeCoinRow[]> {
      return fetchJson<MemeCoinRow[]>(fetchImpl, `${baseUrl}/meme-radar`, withDefaults());
    },

    async addMemeCoin(symbol: string, name?: string): Promise<{ id: string; symbol: string; name: string }> {
      return fetchJson<{ id: string; symbol: string; name: string }>(
        fetchImpl,
        `${baseUrl}/meme-radar/coins`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, name }),
        }),
      );
    },

    async removeMemeCoin(symbol: string): Promise<void> {
      await fetchImpl(`${baseUrl}/meme-radar/coins/${encodeURIComponent(symbol)}`, withDefaults({ method: 'DELETE' }));
    },

    fetchMemeSignalHistory(symbol: string, limit = 100): Promise<MemeHistoryRow[]> {
      return fetchJson<MemeHistoryRow[]>(
        fetchImpl,
        `${baseUrl}/meme-radar/coins/${encodeURIComponent(symbol)}/signal-history?limit=${limit}`,
        withDefaults(),
      );
    },

    async triggerMemeScan(): Promise<{ scanned: number; failed: number }> {
      return fetchJson<{ scanned: number; failed: number }>(
        fetchImpl,
        `${baseUrl}/meme-radar/scan`,
        withDefaults({ method: 'POST' }),
      );
    },

    async fetchTrackingCoins(): Promise<TrackingCoinRow[]> {
      return fetchJson<TrackingCoinRow[]>(fetchImpl, `${baseUrl}/tracking-coins`, withDefaults());
    },

    async addTrackingCoin(symbol: string, name?: string): Promise<{ id: string; symbol: string; name: string }> {
      return fetchJson<{ id: string; symbol: string; name: string }>(
        fetchImpl,
        `${baseUrl}/tracking-coins/coins`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, name }),
        }),
      );
    },

    async removeTrackingCoin(symbol: string): Promise<void> {
      await fetchImpl(`${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}`, withDefaults({ method: 'DELETE' }));
    },

    async triggerTrackingCoinsScan(): Promise<{ scanned: number; failed: number }> {
      return fetchJson<{ scanned: number; failed: number }>(
        fetchImpl,
        `${baseUrl}/tracking-coins/scan`,
        withDefaults({ method: 'POST' }),
      );
    },

    async fetchBitgetPositions(): Promise<BitgetPositionsResponse> {
      return fetchJson<BitgetPositionsResponse>(fetchImpl, `${baseUrl}/bitget/positions`, withDefaults({}));
    },

    async closeBitgetPosition(symbol: string, holdSide: 'long' | 'short'): Promise<void> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/positions/close`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, holdSide }),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Đóng lệnh thất bại (HTTP ${response.status})`);
      }
    },

    async fetchBitgetHistory(params: { limit?: number; symbol?: string } = {}): Promise<BitgetHistoryResponse> {
      const qs = new URLSearchParams();
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.symbol) qs.set('symbol', params.symbol);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return fetchJson<BitgetHistoryResponse>(fetchImpl, `${baseUrl}/bitget/history${suffix}`, withDefaults({}));
    },

    // ── Bitget per-trade journal ────────────────────────────────
    async fetchBitgetJournal(tradeKey: string): Promise<BitgetJournalNote[]> {
      return fetchJson<BitgetJournalNote[]>(
        fetchImpl,
        `${baseUrl}/bitget/journal?tradeKey=${encodeURIComponent(tradeKey)}`,
        withDefaults({}),
      );
    },

    async addBitgetJournal(input: {
      tradeKey: string;
      symbol: string;
      holdSide: 'long' | 'short';
      content: string;
      images: string[];
      snapshot?: BitgetJournalSnapshot;
    }): Promise<BitgetJournalNote> {
      return fetchJson<BitgetJournalNote>(
        fetchImpl,
        `${baseUrl}/bitget/journal`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
    },

    async updateBitgetJournal(id: string, input: { content: string; images: string[] }): Promise<BitgetJournalNote> {
      return fetchJson<BitgetJournalNote>(
        fetchImpl,
        `${baseUrl}/bitget/journal/${encodeURIComponent(id)}`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
    },

    async deleteBitgetJournal(id: string): Promise<void> {
      await fetchImpl(`${baseUrl}/bitget/journal/${encodeURIComponent(id)}`, withDefaults({ method: 'DELETE' }));
    },
  };
}
