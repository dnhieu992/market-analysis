import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createHoldingRepository(client = prisma) {
  return {
    upsert(portfolioId: string, coinId: string, data: Prisma.HoldingUncheckedCreateInput) {
      return client.holding.upsert({
        where: { portfolioId_coinId: { portfolioId, coinId } },
        create: data,
        update: {
          totalAmount: data.totalAmount,
          totalCost: data.totalCost,
          avgCost: data.avgCost,
          realizedPnl: data.realizedPnl
        }
      });
    },
    findByPortfolioAndCoin(portfolioId: string, coinId: string) {
      return client.holding.findUnique({
        where: { portfolioId_coinId: { portfolioId, coinId } }
      });
    },
    listByPortfolio(portfolioId: string) {
      return client.holding.findMany({
        where: { portfolioId },
        orderBy: { coinId: 'asc' }
      });
    },
    update(portfolioId: string, coinId: string, data: Prisma.HoldingUncheckedUpdateInput) {
      return client.holding.update({
        where: { portfolioId_coinId: { portfolioId, coinId } },
        data
      });
    },
    deleteByPortfolioAndCoin(portfolioId: string, coinId: string) {
      return client.holding.deleteMany({
        where: { portfolioId, coinId }
      });
    },
    deleteAllByPortfolio(portfolioId: string) {
      return client.holding.deleteMany({ where: { portfolioId } });
    }
  };
}
