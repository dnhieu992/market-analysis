import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

// Statuses considered "open" — still being tracked by the hourly job.
const OPEN_STATUSES = ['PENDING', 'ENTERED'];

export function createTrackedSetupRepository(client = prisma) {
  return {
    createMany(data: Prisma.TrackedSetupUncheckedCreateInput[]) {
      return client.trackedSetup.createMany({ data });
    },
    async existsForPlan(dailyAnalysisId: string): Promise<boolean> {
      const count = await client.trackedSetup.count({ where: { dailyAnalysisId } });
      return count > 0;
    },
    listOpen() {
      return client.trackedSetup.findMany({
        where: { status: { in: OPEN_STATUSES } },
        orderBy: { planDate: 'asc' }
      });
    },
    listByPlanIds(dailyAnalysisIds: string[]) {
      if (dailyAnalysisIds.length === 0) return Promise.resolve([]);
      return client.trackedSetup.findMany({
        where: { dailyAnalysisId: { in: dailyAnalysisIds } },
        orderBy: { slot: 'asc' }
      });
    },
    listBySymbol(symbol: string, limit = 60) {
      return client.trackedSetup.findMany({
        where: { symbol },
        orderBy: { planDate: 'desc' },
        take: limit
      });
    },
    listLatest(limit = 60) {
      return client.trackedSetup.findMany({
        orderBy: { planDate: 'desc' },
        take: limit
      });
    },
    update(id: string, data: Prisma.TrackedSetupUncheckedUpdateInput) {
      return client.trackedSetup.update({ where: { id }, data });
    }
  };
}
