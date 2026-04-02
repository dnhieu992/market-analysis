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
