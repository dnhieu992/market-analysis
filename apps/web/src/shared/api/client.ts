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
  TrackingSettings,
  TradingStrategy,
  UpdateDashboardOrderInput,
  UpdatePortfolioInput,
  UpdateTradingStrategyInput,
  UpsertSettingsInput,
  UserProfile,
  Conversation,
  ChatMessage,
  TradingJournalEntry,
  TradingJournalRevision,
  TrackingCoinRow,
  TrackingCoinSetup,
  BitgetPositionsResponse,
  BitgetHistoryResponse,
  BitgetOpenResult,
  BitgetTpslResult,
  BitgetSetupConfig,
  BitgetAutoTrade,
  BitgetSymbolPriority,
  BitgetSymbolNote,
  BitgetChartCount,
  BitgetTradeChartCount,
  BitgetQqeSignals,
  BitgetPriceChange,
  BitgetTradeChart,
  BitgetJournalNote,
  BitgetJournalSnapshot,
  MexcPositionsResponse,
  MexcHistoryResponse,
  MexcOpenResult,
  MexcTpslResult,
  MexcSetupConfig,
  MexcSymbolPriority,
  MexcWatchlistSymbol,
  MexcChartCount,
  MexcTradeChartCount,
  MexcQqeSignals,
  MexcPriceChange,
  MexcTradeChart,
  MexcJournalNote,
  MexcJournalSnapshot,
  OrderJournalNote,
  OrderJournalSnapshot,
  AssetCategory,
  AssetSummary,
  AssetTransaction,
  CreateAssetTransactionInput,
  BinanceKline,
  ImageRef,
  SupertrendScanResult,
  SupertrendH4ScanResult,
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

/** System prompt for LLM-reformatting a raw chart note into clean Markdown. */
const CHART_NOTE_REFORMAT_PROMPT =
  'Bạn là trợ lý biên tập ghi chú nhật ký giao dịch. Định dạng lại ghi chú thô của người ' +
  'dùng thành Markdown gọn gàng, dễ đọc: dùng tiêu đề ngắn / gạch đầu dòng / in đậm ở chỗ hợp ' +
  'lý. Giữ NGUYÊN ngôn ngữ của bản gốc. KHÔNG thêm thông tin hay số liệu không có trong ghi chú, ' +
  'không bịa dữ liệu giao dịch. Chỉ trả về đúng nội dung Markdown đã định dạng, không thêm lời dẫn.';

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

/**
 * Like `fetchJson`, but rethrows the API's `message` on failure. The /asset
 * endpoints reject with rules the trader wrote (empty amount, transfer into the
 * same bucket, deleting a category that still has history) — those read far
 * better in the dialog than "Request failed … 409".
 */
async function assetMutation<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const response = await fetchImpl(url, init);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
    throw new Error(message ?? `Request failed for ${url}: ${response.status}`);
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
    fetchCoinKlines(symbol: string, interval: string, limit: number): Promise<BinanceKline[]> {
      return fetchJson<BinanceKline[]>(
        fetchImpl,
        `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/klines?interval=${encodeURIComponent(interval)}&limit=${limit}`,
        withDefaults(),
      );
    },

    fetchTrackingCoinSetup(symbol: string): Promise<TrackingCoinSetup> {
      return fetchJson<TrackingCoinSetup>(
        fetchImpl,
        `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/setup`,
        withDefaults(),
      );
    },

    /** Partial update — only the keys sent are written. */
    updateTrackingCoinSetup(symbol: string, body: Partial<TrackingCoinSetup>): Promise<TrackingCoinSetup & { symbol: string }> {
      return fetchJson<TrackingCoinSetup & { symbol: string }>(
        fetchImpl,
        `${baseUrl}/tracking-coins/coins/${encodeURIComponent(symbol)}/setup`,
        {
          ...withDefaults(),
          method: 'PUT',
          headers: { ...withDefaults().headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
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

    // ── My Asset ────────────────────────────────────────────────
    // Mutations surface the API's own message: the asset rules it enforces
    // ("danh mục còn giao dịch", "số tiền phải lớn hơn 0") are what the trader
    // needs to read, not an HTTP status.
    async fetchAssetSummary(): Promise<AssetSummary> {
      return fetchJson<AssetSummary>(fetchImpl, `${baseUrl}/asset/summary`, withDefaults());
    },

    async createAssetTransaction(input: CreateAssetTransactionInput): Promise<AssetTransaction> {
      return assetMutation<AssetTransaction>(fetchImpl, `${baseUrl}/asset/transactions`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }));
    },

    async deleteAssetTransaction(id: string): Promise<void> {
      await assetMutation<{ id: string }>(
        fetchImpl,
        `${baseUrl}/asset/transactions/${encodeURIComponent(id)}`,
        withDefaults({ method: 'DELETE' }),
      );
    },

    async createAssetCategory(input: { key: string; label: string }): Promise<AssetCategory> {
      return assetMutation<AssetCategory>(fetchImpl, `${baseUrl}/asset/categories`, withDefaults({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }));
    },

    async updateAssetCategory(
      id: string,
      input: { label?: string; sortOrder?: number },
    ): Promise<AssetCategory> {
      return assetMutation<AssetCategory>(
        fetchImpl,
        `${baseUrl}/asset/categories/${encodeURIComponent(id)}`,
        withDefaults({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
    },

    async deleteAssetCategory(id: string): Promise<void> {
      await assetMutation<{ id: string }>(
        fetchImpl,
        `${baseUrl}/asset/categories/${encodeURIComponent(id)}`,
        withDefaults({ method: 'DELETE' }),
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

    async openBitgetPosition(input: {
      symbol: string;
      holdSide: 'long' | 'short';
      marginUsd: number;
      leverage: number;
    }): Promise<BitgetOpenResult> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/positions/open`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Mở lệnh thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetOpenResult;
    },

    /**
     * Set the exchange-side TP/SL of an open position. Both prices are always
     * sent — `null` clears that trigger on Bitget.
     */
    async setBitgetTpsl(input: {
      symbol: string;
      holdSide: 'long' | 'short';
      takeProfitPrice: number | null;
      stopLossPrice: number | null;
    }): Promise<BitgetTpslResult> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/positions/tpsl`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Đặt TP/SL thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetTpslResult;
    },

    // ── Bitget Setup tab configs (per coin + side, persisted) ────
    async fetchBitgetSetupConfigs(): Promise<BitgetSetupConfig[]> {
      return fetchJson<BitgetSetupConfig[]>(fetchImpl, `${baseUrl}/bitget/setup`, withDefaults({}));
    },

    // Current QQE Signals state (long/short) per timeframe for the Setup tab column.
    // `timeframes` narrows the server-side scan (omit for the default M30/1h/4h/1d).
    async fetchBitgetQqeSignals(symbols: string[], timeframes?: readonly string[]): Promise<BitgetQqeSignals[]> {
      if (symbols.length === 0) return [];
      const q = encodeURIComponent(symbols.join(','));
      const tfq = timeframes?.length ? `&timeframes=${encodeURIComponent(timeframes.join(','))}` : '';
      return fetchJson<BitgetQqeSignals[]>(fetchImpl, `${baseUrl}/bitget/qqe-signals?symbols=${q}${tfq}`, withDefaults({}));
    },

    // 7d / 30d price change (ratio) per coin for the Setup tab columns.
    async fetchBitgetPriceChanges(symbols: string[]): Promise<BitgetPriceChange[]> {
      if (symbols.length === 0) return [];
      const q = encodeURIComponent(symbols.join(','));
      return fetchJson<BitgetPriceChange[]>(fetchImpl, `${baseUrl}/bitget/price-changes?symbols=${q}`, withDefaults({}));
    },

    async saveBitgetSetupConfig(input: BitgetSetupConfig): Promise<BitgetSetupConfig> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/setup`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu cấu hình thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetSetupConfig;
    },

    /**
     * Overwrite the config of many coins at once. Every listed side carries its
     * own leverage/margin and is applied to every symbol. Returns the saved rows.
     */
    async saveBitgetSetupConfigsBulk(input: {
      symbols: string[];
      sides: Array<{ holdSide: 'long' | 'short'; leverage: number; marginUsd: number }>;
    }): Promise<BitgetSetupConfig[]> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/setup/bulk`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu cấu hình hàng loạt thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetSetupConfig[];
    },

    // ── Bitget auto-entry (00:00 UTC LONG · TP +2% · 09:00 UTC review) ────
    async fetchBitgetAutoTrades(): Promise<BitgetAutoTrade[]> {
      return fetchJson<BitgetAutoTrade[]>(fetchImpl, `${baseUrl}/bitget/auto-trade`, withDefaults({}));
    },

    async saveBitgetAutoTrade(input: { symbol: string; enabled: boolean }): Promise<BitgetAutoTrade> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/auto-trade`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu cấu hình auto vào lệnh thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetAutoTrade;
    },

    // ── Bitget Setup tab star priority (per coin, drives the default order) ────
    async fetchBitgetSymbolPriorities(): Promise<BitgetSymbolPriority[]> {
      return fetchJson<BitgetSymbolPriority[]>(
        fetchImpl,
        `${baseUrl}/bitget/setup/priority`,
        withDefaults({}),
      );
    },

    async saveBitgetSymbolPriority(input: BitgetSymbolPriority): Promise<BitgetSymbolPriority> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/setup/priority`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu mức ưu tiên thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetSymbolPriority;
    },

    // ── Bitget Setup tab per-coin assessment (free Markdown text) ────
    async fetchBitgetSymbolNotes(): Promise<BitgetSymbolNote[]> {
      return fetchJson<BitgetSymbolNote[]>(
        fetchImpl,
        `${baseUrl}/bitget/setup/note`,
        withDefaults({}),
      );
    },

    async saveBitgetSymbolNote(input: { symbol: string; note: string }): Promise<BitgetSymbolNote> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/setup/note`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu đánh giá thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetSymbolNote;
    },

    // ── Bitget trade-review charts (save annotated PNG to R2 + DB) ────
    async saveBitgetTradeChart(input: {
      tradeKey: string;
      symbol: string;
      timeframe: string;
      holdSide: 'long' | 'short';
      entryPrice: number;
      closePrice: number;
      pnlUsd: number;
      openedAt: number;
      closedAt: number;
      note?: string | null;
    }): Promise<BitgetTradeChart> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/trade-chart/save`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu chart thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetTradeChart;
    },

    async saveBitgetSetupChart(input: {
      symbol: string;
      timeframe: string;
      note?: string | null;
    }): Promise<BitgetTradeChart> {
      const response = await fetchImpl(
        `${baseUrl}/bitget/setup-chart/save`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu chart thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as BitgetTradeChart;
    },

    /**
     * Reformat a free-text chart note into clean Markdown via the stateless LLM
     * endpoint. Same language as the input; no invented data. Returns the
     * reformatted markdown string.
     */
    async reformatChartNote(note: string): Promise<string> {
      const response = await fetchImpl(
        `${baseUrl}/chat`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: CHART_NOTE_REFORMAT_PROMPT },
              { role: 'user', content: note },
            ],
          }),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Định dạng lại thất bại (HTTP ${response.status})`);
      }
      const data = (await response.json()) as { reply: string };
      return (data.reply ?? '').trim();
    },

    async fetchBitgetSavedTradeCharts(tradeKey: string): Promise<BitgetTradeChart[]> {
      return fetchJson<BitgetTradeChart[]>(
        fetchImpl,
        `${baseUrl}/bitget/trade-chart/saved?tradeKey=${encodeURIComponent(tradeKey)}`,
        withDefaults({}),
      );
    },

    async fetchBitgetSavedChartsBySymbol(symbol: string): Promise<BitgetTradeChart[]> {
      return fetchJson<BitgetTradeChart[]>(
        fetchImpl,
        `${baseUrl}/bitget/trade-chart/by-symbol?symbol=${encodeURIComponent(symbol)}`,
        withDefaults({}),
      );
    },

    /** Saved-chart count per coin — the Setup tab's Attachments badge. */
    async fetchBitgetChartCounts(): Promise<BitgetChartCount[]> {
      return fetchJson<BitgetChartCount[]>(
        fetchImpl,
        `${baseUrl}/bitget/trade-chart/counts`,
        withDefaults({}),
      );
    },

    /** Saved-chart count per trade — the History tab's Attachments badge. */
    async fetchBitgetChartCountsByTrade(): Promise<BitgetTradeChartCount[]> {
      return fetchJson<BitgetTradeChartCount[]>(
        fetchImpl,
        `${baseUrl}/bitget/trade-chart/counts-by-trade`,
        withDefaults({}),
      );
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

    // ═══ MEXC (/mexc) ════════════════════════════════════════════
    // Same call shapes as the Bitget methods above against the /mexc
    // routes. Deliberately a separate set: the two exchange pages own
    // their endpoints outright, so neither can break the other.
    async fetchMexcPositions(): Promise<MexcPositionsResponse> {
      return fetchJson<MexcPositionsResponse>(fetchImpl, `${baseUrl}/mexc/positions`, withDefaults({}));
    },

    async closeMexcPosition(symbol: string, holdSide: 'long' | 'short'): Promise<void> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/positions/close`,
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

    async openMexcPosition(input: {
      symbol: string;
      holdSide: 'long' | 'short';
      marginUsd: number;
      leverage: number;
    }): Promise<MexcOpenResult> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/positions/open`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Mở lệnh thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as MexcOpenResult;
    },

    /**
     * Set the exchange-side TP/SL of an open position. Both prices are always
     * sent — `null` clears that trigger on MEXC.
     */
    async setMexcTpsl(input: {
      symbol: string;
      holdSide: 'long' | 'short';
      takeProfitPrice: number | null;
      stopLossPrice: number | null;
    }): Promise<MexcTpslResult> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/positions/tpsl`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Đặt TP/SL thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as MexcTpslResult;
    },

    // ── MEXC Setup tab configs (per coin + side, persisted) ────
    async fetchMexcSetupConfigs(): Promise<MexcSetupConfig[]> {
      return fetchJson<MexcSetupConfig[]>(fetchImpl, `${baseUrl}/mexc/setup`, withDefaults({}));
    },

    // Current QQE Signals state (long/short) per timeframe for the Setup tab column.
    // `timeframes` narrows the server-side scan (omit for the default M30/1h/4h/1d).
    async fetchMexcQqeSignals(symbols: string[], timeframes?: readonly string[]): Promise<MexcQqeSignals[]> {
      if (symbols.length === 0) return [];
      const q = encodeURIComponent(symbols.join(','));
      const tfq = timeframes?.length ? `&timeframes=${encodeURIComponent(timeframes.join(','))}` : '';
      return fetchJson<MexcQqeSignals[]>(fetchImpl, `${baseUrl}/mexc/qqe-signals?symbols=${q}${tfq}`, withDefaults({}));
    },

    // 7d / 30d price change (ratio) per coin for the Setup tab columns.
    async fetchMexcPriceChanges(symbols: string[]): Promise<MexcPriceChange[]> {
      if (symbols.length === 0) return [];
      const q = encodeURIComponent(symbols.join(','));
      return fetchJson<MexcPriceChange[]>(fetchImpl, `${baseUrl}/mexc/price-changes?symbols=${q}`, withDefaults({}));
    },

    async saveMexcSetupConfig(input: MexcSetupConfig): Promise<MexcSetupConfig> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/setup`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu cấu hình thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as MexcSetupConfig;
    },

    /**
     * Overwrite the config of many coins at once. Every listed side carries its
     * own leverage/margin and is applied to every symbol. Returns the saved rows.
     */
    async saveMexcSetupConfigsBulk(input: {
      symbols: string[];
      sides: Array<{ holdSide: 'long' | 'short'; leverage: number; marginUsd: number }>;
    }): Promise<MexcSetupConfig[]> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/setup/bulk`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu cấu hình hàng loạt thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as MexcSetupConfig[];
    },

    // ── MEXC Setup tab star priority (per coin, drives the default order) ────
    async fetchMexcSymbolPriorities(): Promise<MexcSymbolPriority[]> {
      return fetchJson<MexcSymbolPriority[]>(
        fetchImpl,
        `${baseUrl}/mexc/setup/priority`,
        withDefaults({}),
      );
    },

    async saveMexcSymbolPriority(input: MexcSymbolPriority): Promise<MexcSymbolPriority> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/setup/priority`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu mức ưu tiên thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as MexcSymbolPriority;
    },

    // ── MEXC Setup tab watchlist (coins added by hand) ────
    async fetchMexcWatchlist(): Promise<MexcWatchlistSymbol[]> {
      return fetchJson<MexcWatchlistSymbol[]>(
        fetchImpl,
        `${baseUrl}/mexc/setup/watchlist`,
        withDefaults({}),
      );
    },

    async addMexcWatchlistSymbol(symbol: string): Promise<MexcWatchlistSymbol> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/setup/watchlist`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol }),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Thêm coin thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as MexcWatchlistSymbol;
    },

    async deleteMexcWatchlistSymbol(symbol: string): Promise<void> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/setup/watchlist/${encodeURIComponent(symbol)}`,
        withDefaults({ method: 'DELETE' }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Bỏ theo dõi thất bại (HTTP ${response.status})`);
      }
    },

    // ── MEXC trade-review charts (save annotated PNG to R2 + DB) ────
    async saveMexcTradeChart(input: {
      tradeKey: string;
      symbol: string;
      timeframe: string;
      holdSide: 'long' | 'short';
      entryPrice: number;
      closePrice: number;
      pnlUsd: number;
      openedAt: number;
      closedAt: number;
      note?: string | null;
    }): Promise<MexcTradeChart> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/trade-chart/save`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu chart thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as MexcTradeChart;
    },

    async saveMexcSetupChart(input: {
      symbol: string;
      timeframe: string;
      note?: string | null;
    }): Promise<MexcTradeChart> {
      const response = await fetchImpl(
        `${baseUrl}/mexc/setup-chart/save`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
        throw new Error(msg || `Lưu chart thất bại (HTTP ${response.status})`);
      }
      return (await response.json()) as MexcTradeChart;
    },

    async fetchMexcSavedTradeCharts(tradeKey: string): Promise<MexcTradeChart[]> {
      return fetchJson<MexcTradeChart[]>(
        fetchImpl,
        `${baseUrl}/mexc/trade-chart/saved?tradeKey=${encodeURIComponent(tradeKey)}`,
        withDefaults({}),
      );
    },

    async fetchMexcSavedChartsBySymbol(symbol: string): Promise<MexcTradeChart[]> {
      return fetchJson<MexcTradeChart[]>(
        fetchImpl,
        `${baseUrl}/mexc/trade-chart/by-symbol?symbol=${encodeURIComponent(symbol)}`,
        withDefaults({}),
      );
    },

    /** Saved-chart count per coin — the Setup tab's Attachments badge. */
    async fetchMexcChartCounts(): Promise<MexcChartCount[]> {
      return fetchJson<MexcChartCount[]>(
        fetchImpl,
        `${baseUrl}/mexc/trade-chart/counts`,
        withDefaults({}),
      );
    },

    /** Saved-chart count per trade — the History tab's Attachments badge. */
    async fetchMexcChartCountsByTrade(): Promise<MexcTradeChartCount[]> {
      return fetchJson<MexcTradeChartCount[]>(
        fetchImpl,
        `${baseUrl}/mexc/trade-chart/counts-by-trade`,
        withDefaults({}),
      );
    },

    async fetchMexcHistory(params: { limit?: number; symbol?: string } = {}): Promise<MexcHistoryResponse> {
      const qs = new URLSearchParams();
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.symbol) qs.set('symbol', params.symbol);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return fetchJson<MexcHistoryResponse>(fetchImpl, `${baseUrl}/mexc/history${suffix}`, withDefaults({}));
    },

    // ── MEXC per-trade journal ────────────────────────────────
    async fetchMexcJournal(tradeKey: string): Promise<MexcJournalNote[]> {
      return fetchJson<MexcJournalNote[]>(
        fetchImpl,
        `${baseUrl}/mexc/journal?tradeKey=${encodeURIComponent(tradeKey)}`,
        withDefaults({}),
      );
    },

    async addMexcJournal(input: {
      tradeKey: string;
      symbol: string;
      holdSide: 'long' | 'short';
      content: string;
      images: string[];
      snapshot?: MexcJournalSnapshot;
    }): Promise<MexcJournalNote> {
      return fetchJson<MexcJournalNote>(
        fetchImpl,
        `${baseUrl}/mexc/journal`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
    },

    async updateMexcJournal(id: string, input: { content: string; images: string[] }): Promise<MexcJournalNote> {
      return fetchJson<MexcJournalNote>(
        fetchImpl,
        `${baseUrl}/mexc/journal/${encodeURIComponent(id)}`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
    },

    async deleteMexcJournal(id: string): Promise<void> {
      await fetchImpl(`${baseUrl}/mexc/journal/${encodeURIComponent(id)}`, withDefaults({ method: 'DELETE' }));
    },

    // ── /trades per-order journal ───────────────────────────────
    async fetchOrderJournal(orderId: string): Promise<OrderJournalNote[]> {
      return fetchJson<OrderJournalNote[]>(
        fetchImpl,
        `${baseUrl}/orders/journal?orderId=${encodeURIComponent(orderId)}`,
        withDefaults({}),
      );
    },

    async addOrderJournal(input: {
      orderId: string;
      content: string;
      images: string[];
      snapshot?: OrderJournalSnapshot;
    }): Promise<OrderJournalNote> {
      return fetchJson<OrderJournalNote>(
        fetchImpl,
        `${baseUrl}/orders/journal`,
        withDefaults({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
    },

    async updateOrderJournal(id: string, input: { content: string; images: string[] }): Promise<OrderJournalNote> {
      return fetchJson<OrderJournalNote>(
        fetchImpl,
        `${baseUrl}/orders/journal/${encodeURIComponent(id)}`,
        withDefaults({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
    },

    async deleteOrderJournal(id: string): Promise<void> {
      await fetchImpl(`${baseUrl}/orders/journal/${encodeURIComponent(id)}`, withDefaults({ method: 'DELETE' }));
    },

    /** Scans every Binance USDT spot pair for a bullish D1 Supertrend and sends the list to Telegram. */
    async runSupertrendScan(): Promise<SupertrendScanResult> {
      return fetchJson<SupertrendScanResult>(
        fetchImpl,
        `${baseUrl}/supertrend-scan/run`,
        withDefaults({ method: 'POST' }),
      );
    },

    /** Scans every Binance USDT spot pair for a bullish 4H Supertrend + QQE and sends the list to Telegram. */
    async runSupertrendH4Scan(): Promise<SupertrendH4ScanResult> {
      return fetchJson<SupertrendH4ScanResult>(
        fetchImpl,
        `${baseUrl}/supertrend-scan/run-h4`,
        withDefaults({ method: 'POST' }),
      );
    },
  };
}
