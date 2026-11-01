import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createSessionRepository(client = prisma) {
  return {
    create(data: Prisma.SessionUncheckedCreateInput) {
      return client.session.create({ data });
    },
    findValidByTokenHash(tokenHash: string) {
      return client.session.findUnique({
        where: { tokenHash },
        include: { user: true }
      });
    },
    deleteByTokenHash(tokenHash: string) {
      return client.session.deleteMany({
        where: { tokenHash }
      });
    },
    /** Marks the session used and slides its idle expiry forward. */
    touch(id: string, lastUsedAt: Date, expiresAt?: Date) {
      return client.session.update({
        where: { id },
        data: expiresAt ? { lastUsedAt, expiresAt } : { lastUsedAt }
      });
    },
    listActiveByUser(userId: string, now: Date) {
      return client.session.findMany({
        where: { userId, expiresAt: { gt: now } },
        orderBy: { lastUsedAt: 'desc' }
      });
    },
    deleteForUser(userId: string, id: string) {
      return client.session.deleteMany({ where: { id, userId } });
    },
    /** Every session of the user except `keepId` (all of them when it is null). */
    deleteOthers(userId: string, keepId: string | null) {
      return client.session.deleteMany({
        where: keepId ? { userId, id: { not: keepId } } : { userId }
      });
    }
  };
}
