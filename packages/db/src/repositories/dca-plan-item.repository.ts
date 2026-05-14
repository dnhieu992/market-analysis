import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createDcaPlanItemRepository(client = prisma) {
  return {
    create(data: Prisma.DcaPlanItemUncheckedCreateInput) {
      return client.dcaPlanItem.create({ data });
    },
    createMany(data: Prisma.DcaPlanItemUncheckedCreateInput[]) {
      return client.dcaPlanItem.createMany({ data });
    },
    findById(id: string) {
      return client.dcaPlanItem.findUnique({ where: { id } });
    },
    listByPlanId(dcaPlanId: string, includeDeleted = false) {
      return client.dcaPlanItem.findMany({
        where: {
          dcaPlanId,
          ...(includeDeleted ? {} : { deletedByUser: false })
        },
        orderBy: { targetPrice: 'asc' }
      });
    },
    update(id: string, data: Prisma.DcaPlanItemUncheckedUpdateInput) {
      return client.dcaPlanItem.update({ where: { id }, data });
    },
    hardDelete(id: string) {
      return client.dcaPlanItem.delete({ where: { id } });
    }
  };
}
