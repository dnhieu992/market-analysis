import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createOrderRepository(client = prisma) {
  return {
    create(data: Prisma.OrderUncheckedCreateInput) {
      return client.order.create({ data });
    },
    findById(id: string) {
      return client.order.findUnique({ where: { id } });
    },
    listLatest(limit = 20) {
      return client.order.findMany({
        orderBy: { openedAt: 'desc' },
        take: limit
      });
    },
    update(id: string, data: Prisma.OrderUncheckedUpdateInput) {
      return client.order.update({
        where: { id },
        data
      });
    }
  };
}
