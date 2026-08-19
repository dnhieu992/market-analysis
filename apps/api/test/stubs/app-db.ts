const analysisRuns = [
  {
    id: 'seed-run-1',
    symbol: 'BTCUSDT',
    timeframe: '4h',
    candleCloseTime: new Date('2026-04-01T08:00:00.000Z')
  }
];

const signals = [
  {
    id: 'seed-signal-1',
    symbol: 'BTCUSDT',
    timeframe: '4h',
    bias: 'bullish',
    createdAt: new Date('2026-04-01T08:01:00.000Z')
  }
];

const orders: Array<Record<string, unknown>> = [];
const telegramLogs: unknown[] = [];
const users: Array<Record<string, unknown>> = [];
const sessions: Array<Record<string, unknown>> = [];

export const prisma = {};

export function createAnalysisRunRepository() {
  return {
    async create(data: unknown) {
      analysisRuns.push(data as never);
      return data;
    },
    async findById(id: string) {
      return analysisRuns.find((run) => run.id === id) ?? null;
    },
    async findByCandle() {
      return null;
    },
    async listLatest() {
      return analysisRuns;
    },
    async update(id: string, data: Record<string, unknown>) {
      return { id, ...data };
    }
  };
}

export function createSignalRepository() {
  return {
    async create(data: unknown) {
      signals.push(data as never);
      return data;
    },
    async findById(id: string) {
      return signals.find((signal) => signal.id === id) ?? null;
    },
    async findLatestBySymbol(symbol: string, timeframe: string) {
      return signals.find((signal) => signal.symbol === symbol && signal.timeframe === timeframe) ?? null;
    },
    async listLatest() {
      return signals;
    }
  };
}

export function createOrderRepository() {
  return {
    async create(data: unknown) {
      const createdOrder = {
        id: `order-integration-${orders.length + 1}`,
        ...(data as Record<string, unknown>)
      };
      orders.push(createdOrder);
      return createdOrder;
    },
    async findById(id: string) {
      return orders.find((order) => order.id === id) ?? null;
    },
    async listLatest() {
      return orders;
    },
    async update(id: string, data: Record<string, unknown>) {
      const existingOrder = orders.find((order) => order.id === id);
      const updatedOrder = {
        ...existingOrder,
        id,
        ...data
      };

      const index = orders.findIndex((order) => order.id === id);

      if (index >= 0) {
        orders[index] = updatedOrder;
      }

      return updatedOrder;
    },
    async allTimePnlSummary() {
      return tradingBook;
    }
  };
}

/** The manual trade book /my-asset values the `trading` bucket from. */
let tradingBook: {
  closedPnlSum: number;
  openOrders: Array<{ symbol: string; side: string; entryPrice: number; quantity: number | null }>;
} = { closedPnlSum: 0, openOrders: [] };

export function __setTradingBook(
  closedPnlSum: number,
  openOrders: Array<{ symbol: string; side: string; entryPrice: number; quantity: number | null }> = [],
) {
  tradingBook = { closedPnlSum, openOrders };
}

let bitgetRealizedPnl = 0;
let mexcRealizedPnl = 0;
let okxRealizedPnl = 0;

/** Mirrored closed-trade PnL — the /my-asset fallback when an exchange can't be read. */
export function __setExchangeRealizedPnl(bitget: number, mexc: number, okx = 0) {
  bitgetRealizedPnl = bitget;
  mexcRealizedPnl = mexc;
  okxRealizedPnl = okx;
}

export function createBitgetTradeRepository() {
  return {
    async sumRealizedPnl() {
      return bitgetRealizedPnl;
    },
  };
}

export function createMexcTradeRepository() {
  return {
    async sumRealizedPnl() {
      return mexcRealizedPnl;
    },
  };
}

export function createOkxTradeRepository() {
  return {
    async sumRealizedPnl() {
      return okxRealizedPnl;
    },
  };
}

export function createTelegramMessageLogRepository() {
  return {
    async create(data: unknown) {
      telegramLogs.push(data);
      return data;
    },
    async findById() {
      return null;
    },
    async listLatest() {
      return telegramLogs;
    }
  };
}

const dailyAnalysisRecords: unknown[] = [];
let settingsRecord: Record<string, unknown> | null = null;

export function createDailyAnalysisRepository() {
  return {
    async create(data: unknown) {
      const record = {
        status: 'WAIT',
        pipelineDebugJson: null,
        ...(data as Record<string, unknown>)
      };
      dailyAnalysisRecords.push(record);
      return record;
    },
    async findByDate(_symbol: string, _date: Date) {
      return null;
    },
    async listLatest(_symbol: string, _limit?: number) {
      return dailyAnalysisRecords;
    }
  };
}

export function createSettingsRepository() {
  return {
    async findFirst() {
      return settingsRecord;
    },
    async upsert(data: { create: Record<string, unknown>; update: Record<string, unknown> }) {
      settingsRecord = {
        id: 'singleton',
        ...(settingsRecord ?? data.create),
        ...data.update
      };
      return settingsRecord;
    }
  };
}

export function createUserRepository() {
  return {
    async create(data: Record<string, unknown>) {
      const createdUser = {
        id: `user-${users.length + 1}`,
        createdAt: new Date('2026-04-08T00:00:00.000Z'),
        updatedAt: new Date('2026-04-08T00:00:00.000Z'),
        ...data
      };
      users.push(createdUser);
      return createdUser;
    },
    async findByEmail(email: string) {
      return users.find((user) => user.email === email) ?? null;
    },
    async findById(id: string) {
      return users.find((user) => user.id === id) ?? null;
    }
  };
}

export function createBackTestResultRepository() {
  const records: Array<Record<string, unknown>> = [];

  return {
    async create(data: Record<string, unknown>) {
      const record = { id: `back-test-${records.length + 1}`, ...data };
      records.push(record);
      return record;
    },
    async findById(id: string) {
      return records.find((r) => r.id === id) ?? null;
    },
    async listByStrategy(strategy: string, symbol?: string, limit = 20) {
      return records
        .filter((r) => r.strategy === strategy && (!symbol || r.symbol === symbol))
        .slice(-limit);
    },
    async listLatest(limit = 20) {
      return records.slice(-limit);
    }
  };
}

export function createSessionRepository() {
  return {
    async create(data: Record<string, unknown>) {
      const createdSession = {
        id: `session-${sessions.length + 1}`,
        createdAt: new Date('2026-04-08T00:00:00.000Z'),
        lastUsedAt: new Date('2026-04-08T00:00:00.000Z'),
        ...data
      };
      sessions.push(createdSession);
      return createdSession;
    },
    async findValidByTokenHash(tokenHash: string) {
      const session = sessions.find((entry) => entry.tokenHash === tokenHash) ?? null;
      if (!session) {
        return null;
      }

      const user = users.find((entry) => entry.id === session.userId) ?? null;
      return user ? { ...session, user } : null;
    },
    async deleteByTokenHash(tokenHash: string) {
      const nextSessions = sessions.filter((entry) => entry.tokenHash !== tokenHash);
      sessions.splice(0, sessions.length, ...nextSessions);
      return { count: 1 };
    },
    async touch(id: string, lastUsedAt: Date) {
      const session = sessions.find((entry) => entry.id === id);
      if (!session) {
        return null;
      }
      session.lastUsedAt = lastUsedAt;
      return session;
    }
  };
}

// ── My Asset ──────────────────────────────────────────────────────────────────
// A real in-memory ledger, not jest.fn()s: AssetService derives every balance
// from these rows, so the maths is only worth testing against a store that
// actually behaves like the table.

type AssetCategoryRow = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type AssetTransactionRow = {
  id: string;
  type: string;
  amountUsdt: number;
  fromCategoryId: string | null;
  toCategoryId: string | null;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
};

type SpotPosition = { coinId: string; totalAmount: number; totalCost: number };

let spotPositions: SpotPosition[] = [];

/**
 * The spot book AssetService values at market. Amounts and costs are per coin so
 * a test can set a real price and check the resulting unrealized PnL.
 */
export function __setSpotPositions(positions: SpotPosition[]) {
  spotPositions = positions;
}

/** Shorthand for tests that only care about the cost total, priced 1:1 at cost. */
export function __setSpotCostBasis(value: number) {
  spotPositions = value === 0 ? [] : [{ coinId: 'BTC', totalAmount: value, totalCost: value }];
}

let spotRealizedPnl = 0;

/** Profit already banked on spot — /portfolio-pnl's "All-time Realized P&L". */
export function __setSpotRealizedPnl(value: number) {
  spotRealizedPnl = value;
}

export function createHoldingRepository() {
  return {
    async sumTotalCost() {
      return spotPositions.reduce((sum, p) => sum + p.totalCost, 0);
    },
    async sumByCoin() {
      return spotPositions.filter((p) => p.totalAmount > 0);
    },
    async sumRealizedPnl() {
      return spotRealizedPnl;
    },
  };
}

const assetCategories: AssetCategoryRow[] = [];
const assetTransactions: AssetTransactionRow[] = [];

/** Reset the store between tests and optionally seed categories. */
export function __seedAssetStore(categories: Array<{ id: string; key: string; label: string; sortOrder?: number }> = []) {
  assetCategories.splice(0, assetCategories.length);
  assetTransactions.splice(0, assetTransactions.length);
  spotPositions = [];
  spotRealizedPnl = 0;
  for (const c of categories) {
    assetCategories.push({
      id: c.id,
      key: c.key,
      label: c.label,
      sortOrder: c.sortOrder ?? 0,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
  }
}

export function __assetTransactions() {
  return assetTransactions;
}

export function createAssetCategoryRepository() {
  return {
    async findAll() {
      return [...assetCategories].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
      );
    },
    async findById(id: string) {
      return assetCategories.find((c) => c.id === id) ?? null;
    },
    async findByKey(key: string) {
      return assetCategories.find((c) => c.key === key) ?? null;
    },
    async create({ key, label, sortOrder }: { key: string; label: string; sortOrder?: number }) {
      const row: AssetCategoryRow = {
        id: `cat-${assetCategories.length + 1}`,
        key,
        label,
        sortOrder: sortOrder ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      assetCategories.push(row);
      return row;
    },
    async update(id: string, data: { label?: string; sortOrder?: number }) {
      const row = assetCategories.find((c) => c.id === id);
      if (!row) throw new Error(`no category ${id}`);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async deleteById(id: string) {
      const index = assetCategories.findIndex((c) => c.id === id);
      if (index < 0) throw new Error(`no category ${id}`);
      return assetCategories.splice(index, 1)[0];
    },
    async countTransactions(id: string) {
      return assetTransactions.filter((t) => t.fromCategoryId === id || t.toCategoryId === id).length;
    },
  };
}

export function createAssetTransactionRepository() {
  return {
    async findAll(limit = 200) {
      return [...assetTransactions]
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
        .slice(0, limit);
    },
    async create(input: {
      type: string;
      amountUsdt: number;
      fromCategoryId?: string | null;
      toCategoryId?: string | null;
      note?: string | null;
      occurredAt: Date;
    }) {
      const row: AssetTransactionRow = {
        id: `tx-${assetTransactions.length + 1}`,
        type: input.type,
        amountUsdt: input.amountUsdt,
        fromCategoryId: input.fromCategoryId ?? null,
        toCategoryId: input.toCategoryId ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt,
        createdAt: new Date(),
      };
      assetTransactions.push(row);
      return row;
    },
    async deleteById(id: string) {
      const index = assetTransactions.findIndex((t) => t.id === id);
      if (index < 0) throw new Error(`no transaction ${id}`);
      return assetTransactions.splice(index, 1)[0];
    },
    async sumByType() {
      const totals: Record<string, number> = {};
      for (const t of assetTransactions) {
        totals[t.type] = (totals[t.type] ?? 0) + t.amountUsdt;
      }
      return totals;
    },
    async sumBalances() {
      const totals = new Map<string, number>();
      for (const t of assetTransactions) {
        if (t.toCategoryId) totals.set(t.toCategoryId, (totals.get(t.toCategoryId) ?? 0) + t.amountUsdt);
        if (t.fromCategoryId)
          totals.set(t.fromCategoryId, (totals.get(t.fromCategoryId) ?? 0) - t.amountUsdt);
      }
      return Array.from(totals, ([categoryId, balanceUsdt]) => ({ categoryId, balanceUsdt }));
    },
  };
}

/**
 * In-memory stand-in for the BTC day-trade daily log. Mirrors the real
 * repository's contract: one row per date, re-upserting the same date
 * overwrites it and bumps `runCount`.
 */
const btcDaytradeRows: Array<Record<string, unknown>> = [];

export function createBtcDaytradeAnalysisRepository() {
  return {
    async upsertByDate(input: Record<string, unknown>) {
      const key = (input.date as Date).toISOString();
      const existing = btcDaytradeRows.find((row) => (row.date as Date).toISOString() === key);
      if (existing) {
        Object.assign(existing, input, { runCount: (existing.runCount as number) + 1 });
        return existing;
      }
      const row = { id: `btc-daytrade-${key}`, runCount: 1, ...input };
      btcDaytradeRows.push(row);
      return row;
    },
    async findByDate(date: Date) {
      return (
        btcDaytradeRows.find((row) => (row.date as Date).toISOString() === date.toISOString()) ?? null
      );
    },
    async listRecent(limit = 30) {
      return [...btcDaytradeRows]
        .sort((a, b) => (b.date as Date).getTime() - (a.date as Date).getTime())
        .slice(0, limit);
    }
  };
}
