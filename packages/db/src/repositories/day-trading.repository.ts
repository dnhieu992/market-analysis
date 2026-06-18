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

    /** Move the stop to break-even (entry) once the trade reaches +1R. */
    moveStopToBreakEven(id: string, entryPrice: number) {
      return client.dayTradingSignal.update({
        where: { id },
        data: { stopLoss: entryPrice, breakEvenMoved: true },
      });
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

    /**
     * Number of REAL losing trades closed today — used for the daily loss guard.
     * Excludes break-even scratches (SL_HIT after the stop was moved to entry),
     * which close at ~$0 and shouldn't count against the daily loss budget.
     */
    countTodayLosses(symbol: string) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      return client.dayTradingSignal.count({
        where: { symbol, status: 'SL_HIT', breakEvenMoved: false, closedAt: { gte: startOfDay } },
      });
    },

    /** Close time of the most recent REAL loss (excludes break-even scratches) — for the cooldown. */
    async lastLossClosedAt(symbol: string): Promise<Date | null> {
      const row = await client.dayTradingSignal.findFirst({
        where: { symbol, status: 'SL_HIT', breakEvenMoved: false, closedAt: { not: null } },
        orderBy: { closedAt: 'desc' },
        select: { closedAt: true },
      });
      return row?.closedAt ?? null;
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
      const [total, tpHit, slHit, scratch, active, pnlAgg] = await Promise.all([
        client.dayTradingSignal.count(),
        client.dayTradingSignal.count({ where: { status: 'TP_HIT' } }),
        client.dayTradingSignal.count({ where: { status: 'SL_HIT' } }),
        // Break-even scratches: SL_HIT after the stop was ratcheted to entry (~$0 P&L).
        client.dayTradingSignal.count({ where: { status: 'SL_HIT', breakEvenMoved: true } }),
        client.dayTradingSignal.count({ where: { status: 'ACTIVE' } }),
        client.dayTradingSignal.aggregate({
          _sum: { pnlUsd: true },
          where: { status: { in: ['TP_HIT', 'SL_HIT'] } },
        }),
      ]);
      // Win rate counts only decided trades: wins vs REAL losses (scratches excluded).
      const losses = slHit - scratch;
      const decided = tpHit + losses;
      return {
        total,
        active,
        tpHit,
        slHit,
        scratch,
        winRate: decided > 0 ? (tpHit / decided) * 100 : 0,
        totalPnlUsd: pnlAgg._sum.pnlUsd ?? 0,
      };
    },
  };
}
