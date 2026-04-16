import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createPnlHistoryRepository(client = prisma) {
  return {
    async upsertSnapshot(data: Prisma.PnlHistoryUncheckedCreateInput) {
      const date = typeof data.date === 'string' ? new Date(data.date) : (data.date as Date);
      const coinId = data.coinId ?? null;

      const existing = await client.pnlHistory.findFirst({
        where: {
          portfolioId: data.portfolioId,
          coinId: coinId as string | null,
          date
        }
      });

      if (existing) {
        return client.pnlHistory.update({
          where: { id: existing.id },
          data: {
            realizedPnl: data.realizedPnl,
            unrealizedPnl: data.unrealizedPnl,
            totalValue: data.totalValue
          }
        });
      }

      return client.pnlHistory.create({ data: { ...data, date } });
    },
    listByPortfolio(portfolioId: string, options: { coinId?: string | null; from?: Date; to?: Date } = {}) {
      return client.pnlHistory.findMany({
        where: {
          portfolioId,
          ...(options.coinId !== undefined ? { coinId: options.coinId } : {}),
          ...(options.from || options.to
            ? {
                date: {
                  ...(options.from ? { gte: options.from } : {}),
                  ...(options.to ? { lte: options.to } : {})
                }
              }
            : {})
        },
        orderBy: { date: 'asc' }
      });
    }
  };
}
