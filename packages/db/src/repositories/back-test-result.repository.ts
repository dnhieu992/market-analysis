import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createBackTestResultRepository(client = prisma) {
  return {
    create(data: Prisma.BackTestResultUncheckedCreateInput) {
      return client.backTestResult.create({ data });
    },
    findById(id: string) {
      return client.backTestResult.findUnique({ where: { id } });
    },
    listByStrategy(strategy: string, symbol?: string, limit = 20) {
      return client.backTestResult.findMany({
        where: {
          strategy,
          ...(symbol ? { symbol } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      });
    },
    listLatest(limit = 20) {
      return client.backTestResult.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit
      });
    }
  };
}
