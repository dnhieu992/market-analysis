import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createAnalysisRunRepository(client = prisma) {
  return {
    create(data: Prisma.AnalysisRunUncheckedCreateInput) {
      return client.analysisRun.create({ data });
    },
    findById(id: string) {
      return client.analysisRun.findUnique({ where: { id } });
    },
    findByCandle(symbol: string, timeframe: string, candleCloseTime: Date) {
      return client.analysisRun.findUnique({
        where: {
          symbol_timeframe_candleCloseTime: {
            symbol,
            timeframe,
            candleCloseTime
          }
        }
      });
    },
    listLatest(limit = 20) {
      return client.analysisRun.findMany({
        orderBy: { candleCloseTime: 'desc' },
        take: limit
      });
    },
    update(id: string, data: Prisma.AnalysisRunUncheckedUpdateInput) {
      return client.analysisRun.update({
        where: { id },
        data
      });
    }
  };
}
