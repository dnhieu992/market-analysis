import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

/** Statuses the scan job still has to watch — everything else is finished. */
export const STRATEGY_BACKTEST_OPEN_STATUSES = ['PENDING', 'ENTERED'];

/** What the trader fills in by hand; every other column is bookkeeping. */
export type StrategyBacktestSetupInput = Pick<
  Prisma.StrategyBacktestSetupUncheckedCreateInput,
  'symbol' | 'direction' | 'entryPrice' | 'stopLoss' | 'takeProfit' | 'note'
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

    remove(id: string) {
      return client.strategyBacktestSetup.delete({ where: { id } });
    },
  };
}
