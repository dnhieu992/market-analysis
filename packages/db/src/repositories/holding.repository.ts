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
    /**
     * Cost basis of every coin still held, across all portfolios — i.e. the USDT
     * already spent buying spot and not yet freed by a sell. /my-asset subtracts
     * this from the total to work out what is still available to deploy.
     */
    async sumTotalCost(): Promise<number> {
      const { _sum } = await client.holding.aggregate({ _sum: { totalCost: true } });
      return Number(_sum.totalCost ?? 0);
    },
    /**
     * One row per coin, amounts and cost summed across every portfolio. /my-asset
     * needs this (not just the cost total) to value the spot position at market
     * and turn the difference into unrealized PnL.
     */
    async sumByCoin(): Promise<Array<{ coinId: string; totalAmount: number; totalCost: number }>> {
      const rows = await client.holding.groupBy({
        by: ['coinId'],
        _sum: { totalAmount: true, totalCost: true }
      });

      return rows
        .map((r) => ({
          coinId: r.coinId,
          totalAmount: Number(r._sum.totalAmount ?? 0),
          totalCost: Number(r._sum.totalCost ?? 0)
        }))
        // A fully sold-out coin keeps a zero-amount row; it holds no value.
        .filter((r) => r.totalAmount > 0);
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
