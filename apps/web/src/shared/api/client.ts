import type {
  CloseDashboardOrderInput,
  CreateDashboardOrderInput,
  DailyAnalysis,
  DashboardAnalysisRun,
  DashboardHealth,
  DashboardOrder,
  DashboardSignal
} from './types';

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchLike;
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

async function fetchJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchImpl(url);

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
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    date: String(row.date),
    d1Trend: String(row.d1Trend) as DailyAnalysis['d1Trend'],
    h4Trend: String(row.h4Trend) as DailyAnalysis['h4Trend'],
    d1S1: Number(row.d1S1),
    d1S2: Number(row.d1S2),
    d1R1: Number(row.d1R1),
    d1R2: Number(row.d1R2),
    h4S1: Number(row.h4S1),
    h4S2: Number(row.h4S2),
    h4R1: Number(row.h4R1),
    h4R2: Number(row.h4R2),
    summary: String(row.summary ?? ''),
    createdAt: String(row.createdAt)
  };
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? readConfiguredBaseUrl()).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);

  if (!fetchImpl) {
    throw new Error('No fetch implementation available');
  }

  return {
    baseUrl,
    async fetchOrders(): Promise<DashboardOrder[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/orders`);
      return rows.map(mapOrder);
    },
    async fetchSignals(): Promise<DashboardSignal[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/signals`);
      return rows.map(mapSignal);
    },
    async fetchAnalysisRuns(): Promise<DashboardAnalysisRun[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/analysis-runs`);
      return rows.map(mapAnalysisRun);
    },
    async fetchHealth(): Promise<DashboardHealth> {
      return fetchJson<DashboardHealth>(fetchImpl, `${baseUrl}/health`);
    },
    async fetchDailyAnalysis(symbol = 'BTCUSDT'): Promise<DailyAnalysis[]> {
      const rows = await fetchJson<JsonRecord[]>(fetchImpl, `${baseUrl}/daily-analysis?symbol=${symbol}`);
      return rows.map(mapDailyAnalysis);
    },
    async createOrder(input: CreateDashboardOrderInput): Promise<DashboardOrder> {
      const response = await fetchImpl(`${baseUrl}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/orders: ${response.status}`);
      }

      return mapOrder((await response.json()) as JsonRecord);
    },
    async closeOrder(orderId: string, input: CloseDashboardOrderInput): Promise<DashboardOrder> {
      const response = await fetchImpl(`${baseUrl}/orders/${orderId}/close`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/orders/${orderId}/close: ${response.status}`);
      }

      return mapOrder((await response.json()) as JsonRecord);
    }
  };
}
