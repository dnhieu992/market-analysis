import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createStrategyHistoryRepository(client = prisma) {
  return {
    create(data: Prisma.StrategyHistoryUncheckedCreateInput) {
      return client.strategyHistory.create({ data });
    },
    listByStrategy(strategyId: string) {
      return client.strategyHistory.findMany({
        where: { strategyId },
        orderBy: { createdAt: 'desc' }
      });
    },
    findById(id: string) {
      return client.strategyHistory.findUnique({ where: { id } });
    },
    remove(id: string) {
      return client.strategyHistory.delete({ where: { id } });
    }
  };
}
