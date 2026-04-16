import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createPortfolioRepository(client = prisma) {
  return {
    create(data: Prisma.PortfolioUncheckedCreateInput) {
      return client.portfolio.create({ data });
    },
    findById(id: string) {
      return client.portfolio.findUnique({ where: { id } });
    },
    listByUserId(userId: string) {
      return client.portfolio.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' }
      });
    },
    update(id: string, data: Prisma.PortfolioUncheckedUpdateInput) {
      return client.portfolio.update({ where: { id }, data });
    },
    remove(id: string) {
      return client.portfolio.delete({ where: { id } });
    }
  };
}
