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
    listLatest(limit = 20) {
      return client.telegramMessageLog.findMany({
        orderBy: { sentAt: 'desc' },
        take: limit
      });
    }
  };
}
