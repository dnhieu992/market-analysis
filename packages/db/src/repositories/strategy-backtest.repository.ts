import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

/**
 * Statuses the scan job still has to watch. A setup the trader marked INVALID drops
 * out of this list, which is exactly what stops it being tracked.
 */
export const STRATEGY_BACKTEST_OPEN_STATUSES = ['PENDING', 'ENTERED'];

/**
 * What the trader fills in by hand, plus the two columns a MARKET setup is born with:
 * it is created already `ENTERED` at the live price, so it never passes through PENDING.
 * Every other column is bookkeeping the scan job owns.
 */
export type StrategyBacktestSetupInput = Pick<
  Prisma.StrategyBacktestSetupUncheckedCreateInput,
  | 'symbol'
  | 'direction'
  | 'setupType'
  | 'orderType'
  | 'entryPrice'
  | 'stopLoss'
  | 'takeProfit'
  | 'note'
  | 'images'
  | 'status'
  | 'triggeredAt'
  | 'lastPrice'
>;

export function createStrategyBacktestRepository(client = prisma) {
  return {
    create(data: StrategyBacktestSetupInput) {
      return client.strategyBacktestSetup.create({ data });
    },

    findById(id: string) {
      return client.strategyBacktestSetup.findUnique({ where: { id } });
    },

    /** Newest setup first — the page reads the whole history, it stays small. */
    list(limit = 200) {
      return client.strategyBacktestSetup.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    /** PENDING + ENTERED, oldest first so the scan advances them in plan order. */
    listOpen() {
      return client.strategyBacktestSetup.findMany({
        where: { status: { in: STRATEGY_BACKTEST_OPEN_STATUSES } },
        orderBy: { createdAt: 'asc' },
      });
    },

    update(id: string, data: Prisma.StrategyBacktestSetupUncheckedUpdateInput) {
      return client.strategyBacktestSetup.update({ where: { id }, data });
    },
  };
}
