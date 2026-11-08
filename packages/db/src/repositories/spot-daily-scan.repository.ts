import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

/** Daily Strategy A / B scan of the /tracking-coins watchlist (one row per Vietnam-time day). */
export function createSpotDailyScanRepository(client = prisma) {
  return {
    latest() {
      return client.spotDailyScan.findFirst({ orderBy: { scanDate: 'desc' } });
    },

    upsert(scanDate: string, trigger: string, payload: unknown) {
      const data = { trigger, payload: payload as Prisma.InputJsonValue };
      return client.spotDailyScan.upsert({ where: { scanDate }, create: { scanDate, ...data }, update: data });
    },
  };
}
