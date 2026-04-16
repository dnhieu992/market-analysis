import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type TransactionFilter = {
  coinId?: string;
  type?: 'buy' | 'sell';
  from?: Date;
  to?: Date;
};

export function createCoinTransactionRepository(client = prisma) {
  return {
    create(data: Prisma.CoinTransactionUncheckedCreateInput) {
      return client.coinTransaction.create({ data });
    },
    findById(id: string) {
      return client.coinTransaction.findUnique({ where: { id } });
    },
    listByPortfolio(portfolioId: string, filter: TransactionFilter = {}) {
      return client.coinTransaction.findMany({
        where: {
          portfolioId,
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
    listByPortfolioAndCoinOrdered(portfolioId: string, coinId: string) {
      return client.coinTransaction.findMany({
        where: { portfolioId, coinId, deletedAt: null },
        orderBy: { transactedAt: 'asc' }
      });
    },
    softDelete(id: string) {
      return client.coinTransaction.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
    }
  };
}
