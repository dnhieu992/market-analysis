import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createSignalRepository(client = prisma) {
  return {
    create(data: Prisma.SignalUncheckedCreateInput) {
      return client.signal.create({ data });
    },
    findById(id: string) {
      return client.signal.findUnique({ where: { id } });
    },
    findLatestBySymbol(symbol: string, timeframe: string) {
      return client.signal.findFirst({
        where: { symbol, timeframe },
        orderBy: { createdAt: 'desc' }
      });
    },
    listLatest(limit = 20) {
      return client.signal.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit
      });
    }
  };
}
