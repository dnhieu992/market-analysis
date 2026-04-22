import type {
  BackTestResult,
  BackTestResultRecord,
  BackTestStrategy,
  CloseDashboardOrderInput,
  CoinTransaction,
  CompoundHolding,
  CompoundPortfolio,
  CompoundTransaction,
  CreateCompoundPortfolioInput,
  CreateCompoundTransactionInput,
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
  PnlSnapshot,
  Portfolio,
  QueryCompoundTransactionsInput,
  QueryPnlInput,
  QueryTransactionsInput,
  RunBackTestInput,
  TrackingSettings,
  TradingStrategy,
  UpdateCompoundPortfolioInput,
  UpdateDashboardOrderInput,
  UpdatePortfolioInput,
  UpdateProfileInput,
  UpdateTradingStrategyInput,
  UpsertSettingsInput,
  UserProfile
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
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    DEFAULT_API_BASE_URL
  );
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
    createdAt: String(row.createdAt)
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
    realizedPnl: Number(row.realizedPnl)
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

function mapCompoundPortfolio(row: JsonRecord): CompoundPortfolio {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    userId: String(row.userId),
    createdAt: String(row.createdAt)
  };
}

function mapCompoundTransaction(row: JsonRecord): CompoundTransaction {
  return {
    id: String(row.id),
    compoundPortfolioId: String(row.compoundPortfolioId),
    coinId: String(row.coinId),
    type: String(row.type) as 'buy' | 'sell',
    amount: Number(row.amount),
    price: Number(row.price),
    totalValue: Number(row.totalValue),
    fee: row.fee == null ? 0 : Number(row.fee),
    note: row.note == null ? null : String(row.note),
    transactedAt: String(row.transactedAt),
    deletedAt: row.deletedAt == null ? null : String(row.deletedAt),
    createdAt: String(row.createdAt)
  };
}

function mapCompoundHolding(row: JsonRecord): CompoundHolding {
  return {
    compoundPortfolioId: String(row.compoundPortfolioId),
    coinId: String(row.coinId),
    totalAmount: Number(row.totalAmount),
    avgCost: Number(row.avgCost),
    totalInvested: Number(row.totalCost ?? row.totalInvested),
    realizedPnl: Number(row.realizedPnl)
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
    async fetchOrders(): Promise<DashboardOrder[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/orders`, withDefaults());
      return rows.map(mapOrder);
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
    async recalculateHoldings(portfolioId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/portfolios/${portfolioId}/holdings/recalculate`, withDefaults({ method: 'POST' }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/portfolios/${portfolioId}/holdings/recalculate: ${response.status}`);
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
    async fetchCompoundPortfolios(): Promise<CompoundPortfolio[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/compound-portfolios`, withDefaults());
      return rows.map(mapCompoundPortfolio);
    },
    async fetchCompoundPortfolio(id: string): Promise<CompoundPortfolio> {
      const row = await fetchJson<JsonRecord>(fetchImpl, `${baseUrl}/compound-portfolios/${id}`, withDefaults());
      return mapCompoundPortfolio(row);
    },
    async createCompoundPortfolio(input: CreateCompoundPortfolioInput): Promise<CompoundPortfolio> {
      const response = await fetchImpl(`${baseUrl}/compound-portfolios`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/compound-portfolios: ${response.status}`);
      return mapCompoundPortfolio((await response.json()) as JsonRecord);
    },
    async updateCompoundPortfolio(id: string, input: UpdateCompoundPortfolioInput): Promise<CompoundPortfolio> {
      const response = await fetchImpl(`${baseUrl}/compound-portfolios/${id}`, withDefaults({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/compound-portfolios/${id}: ${response.status}`);
      return mapCompoundPortfolio((await response.json()) as JsonRecord);
    },
    async deleteCompoundPortfolio(id: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/compound-portfolios/${id}`, withDefaults({ method: 'DELETE' }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/compound-portfolios/${id}: ${response.status}`);
    },
    async fetchCompoundTransactions(portfolioId: string, query?: QueryCompoundTransactionsInput): Promise<CompoundTransaction[]> {
      const params = new URLSearchParams();
      if (query?.coinId) params.set('coinId', query.coinId);
      if (query?.type) params.set('type', query.type);
      if (query?.from) params.set('from', query.from);
      if (query?.to) params.set('to', query.to);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/compound-portfolios/${portfolioId}/transactions${qs}`, withDefaults());
      return rows.map(mapCompoundTransaction);
    },
    async createCompoundTransaction(portfolioId: string, input: CreateCompoundTransactionInput): Promise<CompoundTransaction> {
      const response = await fetchImpl(`${baseUrl}/compound-portfolios/${portfolioId}/transactions`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/compound-portfolios/${portfolioId}/transactions: ${response.status}`);
      return mapCompoundTransaction((await response.json()) as JsonRecord);
    },
    async deleteCompoundTransaction(portfolioId: string, id: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/compound-portfolios/${portfolioId}/transactions/${id}`, withDefaults({ method: 'DELETE' }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/compound-portfolios/${portfolioId}/transactions/${id}: ${response.status}`);
    },
    async fetchCompoundHoldings(portfolioId: string, prices?: Record<string, number>): Promise<CompoundHolding[]> {
      const params = new URLSearchParams();
      if (prices) params.set('prices', JSON.stringify(prices));
      const qs = params.toString() ? `?${params.toString()}` : '';
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/compound-portfolios/${portfolioId}/holdings${qs}`, withDefaults());
      return rows.map(mapCompoundHolding);
    },
    async recalculateCompoundHoldings(portfolioId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/compound-portfolios/${portfolioId}/holdings/recalculate`, withDefaults({ method: 'POST' }));
      if (!response.ok) throw new Error(`Request failed for ${baseUrl}/compound-portfolios/${portfolioId}/holdings/recalculate: ${response.status}`);
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
      };
    },
    async updateUserProfile(input: UpdateProfileInput): Promise<UserProfile> {
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
      };
    },
  };
}
