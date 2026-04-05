import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createDailyAnalysisRepository(client = prisma) {
  return {
    create(data: Prisma.DailyAnalysisUncheckedCreateInput) {
      return client.dailyAnalysis.create({ data });
    },
    findByDate(symbol: string, date: Date) {
      return client.dailyAnalysis.findUnique({
        where: { symbol_date: { symbol, date } }
      });
    },
    listLatest(symbol: string, limit = 30) {
      return client.dailyAnalysis.findMany({
        where: { symbol },
        orderBy: { date: 'desc' },
        take: limit
      });
    }
  };
}
