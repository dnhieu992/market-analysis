import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export const SCALP_PAPER_TRADE_OPEN_STATUS = 'OPEN';

export type ScalpPaperTradeInput = Pick<
  Prisma.ScalpPaperTradeUncheckedCreateInput,
  | 'symbol'
  | 'direction'
  | 'entryPrice'
  | 'initialStopLoss'
  | 'stopLoss'
  | 'takeProfit'
  | 'riskUsd'
  | 'quantity'
  | 'rrPlanned'
  | 'h1Trend'
  | 'reasoning'
  | 'model'
  | 'openedAt'
  | 'lastPrice'
  | 'lastCheckedAt'
>;

export function createScalpPaperTradeRepository(client = prisma) {
  return {
    create(data: ScalpPaperTradeInput) {
      return client.scalpPaperTrade.create({ data });
    },

    /** At most one at a time in practice (the monitor is single-symbol, single-position). */
    findOpen() {
      return client.scalpPaperTrade.findFirst({
        where: { status: SCALP_PAPER_TRADE_OPEN_STATUS },
        orderBy: { openedAt: 'desc' },
      });
    },

    /** Newest first — the page reads the whole history, it stays small. */
    list(limit = 200) {
      return client.scalpPaperTrade.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    update(id: string, data: Prisma.ScalpPaperTradeUncheckedUpdateInput) {
      return client.scalpPaperTrade.update({ where: { id }, data });
    },
  };
}
