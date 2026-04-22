import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createCompoundHoldingRepository(client = prisma) {
  return {
    upsert(compoundPortfolioId: string, coinId: string, data: Prisma.CompoundHoldingUncheckedCreateInput) {
      return client.compoundHolding.upsert({
        where: { compoundPortfolioId_coinId: { compoundPortfolioId, coinId } },
        create: data,
        update: {
          totalAmount: data.totalAmount,
          totalCost: data.totalCost,
          avgCost: data.avgCost,
          realizedPnl: data.realizedPnl
        }
      });
    },
    findByPortfolioAndCoin(compoundPortfolioId: string, coinId: string) {
      return client.compoundHolding.findUnique({
        where: { compoundPortfolioId_coinId: { compoundPortfolioId, coinId } }
      });
    },
    listByPortfolio(compoundPortfolioId: string) {
      return client.compoundHolding.findMany({
        where: { compoundPortfolioId },
        orderBy: { coinId: 'asc' }
      });
    },
    update(compoundPortfolioId: string, coinId: string, data: Prisma.CompoundHoldingUncheckedUpdateInput) {
      return client.compoundHolding.update({
        where: { compoundPortfolioId_coinId: { compoundPortfolioId, coinId } },
        data
      });
    },
    deleteByPortfolioAndCoin(compoundPortfolioId: string, coinId: string) {
      return client.compoundHolding.deleteMany({
        where: { compoundPortfolioId, coinId }
      });
    },
    deleteAllByPortfolio(compoundPortfolioId: string) {
      return client.compoundHolding.deleteMany({ where: { compoundPortfolioId } });
    }
  };
}
