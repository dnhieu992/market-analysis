import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createTelegramMessageLogRepository(client = prisma) {
  return {
    create(data: Prisma.TelegramMessageLogUncheckedCreateInput) {
      return client.telegramMessageLog.create({ data });
    },
    findById(id: string) {
      return client.telegramMessageLog.findUnique({ where: { id } });
    },
    /** messageType of successful sends since `since` whose type starts with `prefix` (alert dedup keys). */
    listTypesSince(prefix: string, since: Date) {
      return client.telegramMessageLog.findMany({
        where: { messageType: { startsWith: prefix }, success: true, sentAt: { gte: since } },
        select: { messageType: true }
      });
    },
    listLatest(limit = 20) {
      return client.telegramMessageLog.findMany({
        orderBy: { sentAt: 'desc' },
        take: limit
      });
    }
  };
}
