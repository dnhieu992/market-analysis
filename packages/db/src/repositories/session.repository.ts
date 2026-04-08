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
    touch(id: string, lastUsedAt: Date) {
      return client.session.update({
        where: { id },
        data: { lastUsedAt }
      });
    }
  };
}
