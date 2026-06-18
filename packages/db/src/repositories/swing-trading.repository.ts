import { prisma } from '../client';

/**
 * Repository for the swing-trading feature (UTBot trend stop-and-reverse on candle close).
 * Unlike day-trading there is no fixed TP/SL exit — a position is CLOSED only when the
 * trend flips, so win/loss is derived from the realized pnlUsd sign.
 */
export function createSwingTradingRepository(client = prisma) {
  return {
    createSignal(data: {
      symbol: string;
      timeframe: string;
      setupType?: string;
      direction: string;
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      rrRatio?: number;
      riskAmount: number;
      keyValue: number;
      entryLineDistancePct?: number;
      quantity?: number;
      positionValue?: number;
      status: string;
      mode?: string;
      legKind?: string;
      pullbackArmed?: boolean;
      setupJson: string;
      note?: string | null;
      detectedAt: Date;
    }) {
      return client.swingTradingSignal.create({ data });
    },

    /** Most recent signal for dedup / current-position lookup. */
    findLatestSignal(symbol: string) {
      return client.swingTradingSignal.findFirst({
        where: { symbol },
        orderBy: { detectedAt: 'desc' },
      });
    },

    findActiveSignals(symbol?: string) {
      return client.swingTradingSignal.findMany({
        where: { status: 'ACTIVE', ...(symbol ? { symbol } : {}) },
        orderBy: { detectedAt: 'asc' },
      });
    },

    findSignals(params: { status?: string; limit?: number; offset?: number; from?: Date; to?: Date }) {
      const { status, limit = 50, offset = 0, from, to } = params;
      return client.swingTradingSignal.findMany({
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
      return client.swingTradingSignal.count({
        where: {
          ...(status ? { status } : {}),
          ...(from || to ? { detectedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
      });
    },

    findById(id: string) {
      return client.swingTradingSignal.findUnique({ where: { id } });
    },

    /** Close an open position when the trend flips (stop-and-reverse). */
    closeSignal(id: string, data: { closedPrice: number; closedAt: Date; pnlUsd: number; status?: string }) {
      return client.swingTradingSignal.update({
        where: { id },
        data: { status: data.status ?? 'CLOSED', closedPrice: data.closedPrice, closedAt: data.closedAt, pnlUsd: data.pnlUsd },
      });
    },

    /** Update the trailing stop level on an open position (UTBot stop ratchets each candle). */
    updateStopLoss(id: string, stopLoss: number) {
      return client.swingTradingSignal.update({ where: { id }, data: { stopLoss } });
    },

    /**
     * Bank a partial take-profit: leave the remaining `quantity` open, store the
     * realized P&L from the closed half, ratchet the stop to breakeven and flag the
     * leg so the partial fires only once.
     */
    applyPartialTake(id: string, data: { quantity: number; realizedPnlUsd: number; stopLoss: number }) {
      return client.swingTradingSignal.update({
        where: { id },
        data: {
          quantity: data.quantity,
          realizedPnlUsd: data.realizedPnlUsd,
          stopLoss: data.stopLoss,
          partialClosed: true,
          breakEvenMoved: true,
        },
      });
    },

    /** Toggle the pullback re-arm state on the BASE leg of an open trend. */
    setPullbackArmed(id: string, pullbackArmed: boolean) {
      return client.swingTradingSignal.update({ where: { id }, data: { pullbackArmed } });
    },

    /** Manual trader note (markdown) attached to a signal — works for any status. */
    updateNote(id: string, note: string | null) {
      return client.swingTradingSignal.update({ where: { id }, data: { note } });
    },

    /** Append one markdown line to a signal's note (auto-journal of lifecycle events). */
    async appendNote(id: string, line: string) {
      const row = await client.swingTradingSignal.findUnique({ where: { id }, select: { note: true } });
      const prev = row?.note?.trimEnd();
      const note = prev ? `${prev}\n${line}` : line;
      return client.swingTradingSignal.update({ where: { id }, data: { note } });
    },

    /** Singleton config — created with defaults on first access. */
    getSettings() {
      return client.swingTradingSettings.upsert({
        where: { id: 'singleton' },
        create: {},
        update: {},
      });
    },

    updateSettings(data: {
      symbol?: string;
      timeframe?: string;
      atrPeriod?: number;
      keyValue?: number;
      riskPerTrade?: number;
      leverage?: number;
      mode?: string;
    }) {
      return client.swingTradingSettings.upsert({
        where: { id: 'singleton' },
        create: { ...data },
        update: { ...data },
      });
    },

    async getStats() {
      const [total, active, wins, losses, pnlAgg] = await Promise.all([
        client.swingTradingSignal.count(),
        client.swingTradingSignal.count({ where: { status: 'ACTIVE' } }),
        client.swingTradingSignal.count({ where: { status: 'CLOSED', pnlUsd: { gt: 0 } } }),
        client.swingTradingSignal.count({ where: { status: 'CLOSED', pnlUsd: { lt: 0 } } }),
        client.swingTradingSignal.aggregate({
          _sum: { pnlUsd: true },
          where: { status: 'CLOSED' },
        }),
      ]);
      const closed = wins + losses;
      return {
        total,
        active,
        wins,
        losses,
        winRate: closed > 0 ? (wins / closed) * 100 : 0,
        totalPnlUsd: pnlAgg._sum.pnlUsd ?? 0,
      };
    },
  };
}
