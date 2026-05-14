import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createDcaConfigRepository(client = prisma) {
  return {
    create(data: Prisma.DcaConfigUncheckedCreateInput) {
      return client.dcaConfig.create({ data });
    },
    findById(id: string) {
      return client.dcaConfig.findUnique({ where: { id } });
    },
    findByUserAndCoin(userId: string, coin: string) {
      return client.dcaConfig.findUnique({
        where: { userId_coin: { userId, coin } }
      });
    },
    listByUserId(userId: string) {
      return client.dcaConfig.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' }
      });
    },
    update(id: string, data: Prisma.DcaConfigUncheckedUpdateInput) {
      return client.dcaConfig.update({ where: { id }, data });
    }
  };
}
