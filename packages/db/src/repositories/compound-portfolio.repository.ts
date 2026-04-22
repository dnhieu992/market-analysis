import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createCompoundPortfolioRepository(client = prisma) {
  return {
    create(data: Prisma.CompoundPortfolioUncheckedCreateInput) {
      return client.compoundPortfolio.create({ data });
    },
    findById(id: string) {
      return client.compoundPortfolio.findUnique({ where: { id } });
    },
    listByUserId(userId: string) {
      return client.compoundPortfolio.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' }
      });
    },
    update(id: string, data: Prisma.CompoundPortfolioUncheckedUpdateInput) {
      return client.compoundPortfolio.update({ where: { id }, data });
    },
    remove(id: string) {
      return client.compoundPortfolio.delete({ where: { id } });
    }
  };
}
