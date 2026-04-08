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
    }
  };
}
