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
    }
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
