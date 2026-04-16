import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createTradingStrategyRepository(client = prisma) {
  return {
    create(data: Prisma.TradingStrategyUncheckedCreateInput) {
      return client.tradingStrategy.create({ data });
    },
    findById(id: string) {
      return client.tradingStrategy.findUnique({ where: { id } });
    },
    listAll() {
      return client.tradingStrategy.findMany({
        orderBy: { createdAt: 'desc' }
      });
    },
    update(id: string, data: Prisma.TradingStrategyUncheckedUpdateInput) {
      return client.tradingStrategy.update({ where: { id }, data });
    },
    remove(id: string) {
      return client.tradingStrategy.delete({ where: { id } });
    }
  };
}
