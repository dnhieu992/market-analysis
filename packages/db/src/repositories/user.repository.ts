import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createUserRepository(client = prisma) {
  return {
    create(data: Prisma.UserCreateInput) {
      return client.user.create({ data });
    },
    findByEmail(email: string) {
      return client.user.findUnique({ where: { email } });
    },
    findById(id: string) {
      return client.user.findUnique({ where: { id } });
    },
    findFirst() {
      return client.user.findFirst();
    },
    updateSymbolsTracking(userId: string, symbols: string[]) {
      return client.user.update({
        where: { id: userId },
        data: { symbolsTracking: symbols },
      });
    },
    updateProfile(userId: string, data: Prisma.UserUpdateInput) {
      return client.user.update({ where: { id: userId }, data });
    },
  };
}
