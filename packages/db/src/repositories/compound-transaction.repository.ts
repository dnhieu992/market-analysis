import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type CompoundTransactionFilter = {
  coinId?: string;
  type?: 'buy' | 'sell';
  from?: Date;
  to?: Date;
};

export function createCompoundTransactionRepository(client = prisma) {
  return {
    create(data: Prisma.CompoundTransactionUncheckedCreateInput) {
      return client.compoundTransaction.create({ data });
    },
    findById(id: string) {
      return client.compoundTransaction.findUnique({ where: { id } });
    },
    listByPortfolio(compoundPortfolioId: string, filter: CompoundTransactionFilter = {}) {
      return client.compoundTransaction.findMany({
        where: {
          compoundPortfolioId,
          deletedAt: null,
          ...(filter.coinId ? { coinId: filter.coinId } : {}),
          ...(filter.type ? { type: filter.type } : {}),
          ...(filter.from || filter.to
            ? {
                transactedAt: {
                  ...(filter.from ? { gte: filter.from } : {}),
                  ...(filter.to ? { lte: filter.to } : {})
                }
              }
            : {})
        },
        orderBy: { transactedAt: 'desc' }
      });
    },
    listByPortfolioAndCoinOrdered(compoundPortfolioId: string, coinId: string) {
      return client.compoundTransaction.findMany({
        where: { compoundPortfolioId, coinId, deletedAt: null },
        orderBy: { transactedAt: 'asc' }
      });
    },
    softDelete(id: string) {
      return client.compoundTransaction.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
    }
  };
}
