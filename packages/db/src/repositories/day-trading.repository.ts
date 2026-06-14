import { prisma } from '../client';

export function createDayTradingRepository(client = prisma) {
  return {
    createSignal(data: {
      symbol: string;
      setupType: string;
      direction: string;
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      rrRatio: number;
      riskAmount: number;
      quantity?: number;
      positionValue?: number;
      status: string;
      mode?: string;
      setupJson: string;
      detectedAt: Date;
    }) {
      return client.dayTradingSignal.create({ data });
    },

    /** Most recent signal for dedup — avoid re-firing the same setup across consecutive candles. */
    findLatestSignal(symbol: string) {
      return client.dayTradingSignal.findFirst({
        where: { symbol },
        orderBy: { detectedAt: 'desc' },
      });
    },

    findActiveSignals(symbol?: string) {
      return client.dayTradingSignal.findMany({
        where: { status: 'ACTIVE', ...(symbol ? { symbol } : {}) },
        orderBy: { detectedAt: 'asc' },
      });
    },

    findSignals(params: { status?: string; limit?: number; offset?: number; from?: Date; to?: Date }) {
      const { status, limit = 50, offset = 0, from, to } = params;
      return client.dayTradingSignal.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(from || to ? { detectedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        orderBy: { detectedAt: 'desc' },
        take: limit,
        skip: offset,
      });
    },

    countSignals(params: { status?: string; from?: Date; to?: Date }) {
      const { status, from, to } = params;
      return client.dayTradingSignal.count({
        where: {
          ...(status ? { status } : {}),
          ...(from || to ? { detectedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
      });
    },

    findById(id: string) {
      return client.dayTradingSignal.findUnique({ where: { id } });
    },

    updateSignalResult(id: string, data: { status: string; closedPrice: number; closedAt: Date; pnlUsd: number }) {
      return client.dayTradingSignal.update({ where: { id }, data });
    },

    /** Manual trader note (markdown) attached to a signal — works for any status. */
    updateNote(id: string, note: string | null) {
      return client.dayTradingSignal.update({ where: { id }, data: { note } });
    },

    countTodaySignals(symbol: string) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      return client.dayTradingSignal.count({ where: { symbol, detectedAt: { gte: startOfDay } } });
    },

    /** Number of losing (SL_HIT) trades closed today — used for the daily loss guard. */
    countTodayLosses(symbol: string) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      return client.dayTradingSignal.count({
        where: { symbol, status: 'SL_HIT', closedAt: { gte: startOfDay } },
      });
    },

    /** Singleton config — created with defaults on first access. */
    getSettings() {
      return client.dayTradingSettings.upsert({
        where: { id: 'singleton' },
        create: {},
        update: {},
      });
    },

    updateSettings(data: {
      riskPerTrade?: number;
      minRR?: number;
      maxTradesPerDay?: number;
      maxLossesPerDay?: number;
    }) {
      return client.dayTradingSettings.upsert({
        where: { id: 'singleton' },
        create: { ...data },
        update: { ...data },
      });
    },

    async getStats() {
      const [total, tpHit, slHit, active, pnlAgg] = await Promise.all([
        client.dayTradingSignal.count(),
        client.dayTradingSignal.count({ where: { status: 'TP_HIT' } }),
        client.dayTradingSignal.count({ where: { status: 'SL_HIT' } }),
        client.dayTradingSignal.count({ where: { status: 'ACTIVE' } }),
        client.dayTradingSignal.aggregate({
          _sum: { pnlUsd: true },
          where: { status: { in: ['TP_HIT', 'SL_HIT'] } },
        }),
      ]);
      const closed = tpHit + slHit;
      return {
        total,
        active,
        tpHit,
        slHit,
        winRate: closed > 0 ? (tpHit / closed) * 100 : 0,
        totalPnlUsd: pnlAgg._sum.pnlUsd ?? 0,
      };
    },
  };
}
