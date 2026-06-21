import { prisma } from '../client';

/**
 * Repository for the "Long Signal" strategy (LONG-only intraday FOMO gated by the
 * M30 UTBot trend). Mirrors the day-trading repo shape so the API/worker code and
 * the web feed can reuse the same patterns.
 */
export function createLongSignalRepository(client = prisma) {
  return {
    createSignal(data: {
      symbol: string;
      direction?: string;
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      keyValue: number;
      entryLineDistancePct?: number;
      quantity?: number;
      positionValue?: number;
      status: string;
      mode?: string;
      brokerOrderId?: string | null;
      setupJson: string;
      note?: string | null;
      detectedAt: Date;
    }) {
      return client.longSignal.create({ data });
    },

    /** Store the Bitget order id once a LIVE order is placed. */
    attachBrokerOrder(id: string, brokerOrderId: string) {
      return client.longSignal.update({ where: { id }, data: { brokerOrderId } });
    },

    /** Mark a signal FAILED when the LIVE order could not be placed. */
    markSignalFailed(id: string) {
      return client.longSignal.update({ where: { id }, data: { status: 'FAILED' } });
    },

    findActiveSignals(symbol?: string) {
      return client.longSignal.findMany({
        where: { status: 'ACTIVE', ...(symbol ? { symbol } : {}) },
        orderBy: { detectedAt: 'asc' },
      });
    },

    findSignals(params: { status?: string; limit?: number; offset?: number; from?: Date; to?: Date }) {
      const { status, limit = 50, offset = 0, from, to } = params;
      return client.longSignal.findMany({
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
      return client.longSignal.count({
        where: {
          ...(status ? { status } : {}),
          ...(from || to ? { detectedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
      });
    },

    findById(id: string) {
      return client.longSignal.findUnique({ where: { id } });
    },

    /**
     * Has a signal already been created for this symbol today (since 00:00 UTC)?
     * One entry per coin per day — the entry cron is idempotent on re-runs.
     */
    async hasSignalToday(symbol: string): Promise<boolean> {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const count = await client.longSignal.count({
        where: { symbol, detectedAt: { gte: startOfDay } },
      });
      return count > 0;
    },

    /**
     * Race-safe close: only succeeds while the signal is still ACTIVE. Returns
     * true if THIS call closed it, false if it was already closed.
     */
    async closeActiveSignal(
      id: string,
      data: { status: string; closedPrice: number; closedAt: Date; pnlUsd: number },
    ): Promise<boolean> {
      const res = await client.longSignal.updateMany({ where: { id, status: 'ACTIVE' }, data });
      return res.count > 0;
    },

    /** Manual trader note (markdown) attached to a signal — works for any status. */
    updateNote(id: string, note: string | null) {
      return client.longSignal.update({ where: { id }, data: { note } });
    },

    appendNote(id: string, line: string) {
      return client.$transaction(async (tx) => {
        const row = await tx.longSignal.findUnique({ where: { id }, select: { note: true } });
        const note = row?.note ? `${row.note}\n${line}` : line;
        return tx.longSignal.update({ where: { id }, data: { note } });
      });
    },

    /** Singleton config — created with defaults on first access. */
    getSettings() {
      return client.longSignalSettings.upsert({ where: { id: 'singleton' }, create: {}, update: {} });
    },

    updateSettings(data: {
      notional?: number;
      keyValue?: number;
      atrPeriod?: number;
      tpPct?: number;
      catastropheStopPct?: number;
      entryHour?: number;
      exitHour?: number;
      leverage?: number;
      symbols?: string;
      mode?: string;
    }) {
      return client.longSignalSettings.upsert({ where: { id: 'singleton' }, create: { ...data }, update: { ...data } });
    },

    async getStats() {
      const [total, tpHit, slHit, forceClose, manualClose, active, pnlAgg] = await Promise.all([
        client.longSignal.count(),
        client.longSignal.count({ where: { status: 'TP_HIT' } }),
        client.longSignal.count({ where: { status: 'SL_HIT' } }),
        client.longSignal.count({ where: { status: 'FORCE_CLOSE' } }),
        client.longSignal.count({ where: { status: 'MANUAL_CLOSE' } }),
        client.longSignal.count({ where: { status: 'ACTIVE' } }),
        client.longSignal.aggregate({
          _sum: { pnlUsd: true },
          where: { status: { in: ['TP_HIT', 'SL_HIT', 'FORCE_CLOSE', 'MANUAL_CLOSE'] } },
        }),
      ]);
      // Win rate = profitable closes / all decided closes. A FORCE_CLOSE can be a
      // win or a loss, so it's bucketed by sign at read time via the closes query.
      const closed = await client.longSignal.findMany({
        where: { status: { in: ['TP_HIT', 'SL_HIT', 'FORCE_CLOSE', 'MANUAL_CLOSE'] } },
        select: { pnlUsd: true },
      });
      const wins = closed.filter((c) => (c.pnlUsd ?? 0) > 0).length;
      const decided = closed.length;
      return {
        total,
        active,
        tpHit,
        slHit,
        forceClose,
        manualClose,
        wins,
        winRate: decided > 0 ? (wins / decided) * 100 : 0,
        totalPnlUsd: pnlAgg._sum.pnlUsd ?? 0,
      };
    },
  };
}
