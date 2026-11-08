import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

/** Daily setup A / B scan of the /short-junk list (one row per Vietnam-time day). */
export function createJunkShortDailyScanRepository(client = prisma) {
  return {
    latest() {
      return client.junkShortDailyScan.findFirst({ orderBy: { scanDate: 'desc' } });
    },

    upsert(scanDate: string, trigger: string, payload: unknown) {
      const data = { trigger, payload: payload as Prisma.InputJsonValue };
      return client.junkShortDailyScan.upsert({ where: { scanDate }, create: { scanDate, ...data }, update: data });
    },
  };
}
