import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type CompoundTradeFilter = {
  coinId?: string;
  type?: 'buy' | 'sell';
  from?: Date;
  to?: Date;
};

export function createCompoundTradeRepository(client = prisma) {
  return {
    create(data: Prisma.CompoundTradeUncheckedCreateInput) {
      return client.compoundTrade.create({ data });
    },
    findById(id: string) {
      return client.compoundTrade.findUnique({ where: { id } });
    },
    listByUser(userId: string, filter: CompoundTradeFilter = {}) {
      return client.compoundTrade.findMany({
        where: {
          userId,
          ...(filter.coinId ? { coinId: filter.coinId } : {}),
          ...(filter.type ? { type: filter.type } : {}),
          ...(filter.from || filter.to
            ? {
                tradedAt: {
                  ...(filter.from ? { gte: filter.from } : {}),
                  ...(filter.to ? { lte: filter.to } : {})
                }
              }
            : {})
        },
        orderBy: { tradedAt: 'desc' }
      });
    },
    update(id: string, data: Prisma.CompoundTradeUncheckedUpdateInput) {
      return client.compoundTrade.update({ where: { id }, data });
    },
    remove(id: string) {
      return client.compoundTrade.delete({ where: { id } });
    }
  };
}
