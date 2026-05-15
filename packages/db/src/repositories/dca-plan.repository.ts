import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createDcaPlanRepository(client = prisma) {
  return {
    create(data: Prisma.DcaPlanUncheckedCreateInput) {
      return client.dcaPlan.create({ data });
    },
    findById(id: string) {
      return client.dcaPlan.findUnique({ where: { id } });
    },
    findActiveByConfigId(dcaConfigId: string) {
      return client.dcaPlan.findFirst({
        where: { dcaConfigId, status: 'active' },
        include: {
          items: {
            where: { deletedByUser: false },
            orderBy: { targetPrice: 'asc' }
          }
        }
      });
    },
    listArchivedByConfigId(dcaConfigId: string) {
      return client.dcaPlan.findMany({
        where: { dcaConfigId, status: 'archived' },
        include: {
          items: {
            where: { deletedByUser: false },
            orderBy: { targetPrice: 'asc' }
          }
        },
        orderBy: { archivedAt: 'desc' }
      });
    },
    archiveActive(dcaConfigId: string) {
      return client.dcaPlan.updateMany({
        where: { dcaConfigId, status: 'active' },
        data: { status: 'archived', archivedAt: new Date() }
      });
    },
    updateAnalysis(id: string, llmAnalysis: string) {
      return client.dcaPlan.update({
        where: { id },
        data: { llmAnalysis }
      });
    },
    deleteById(id: string) {
      return client.dcaPlan.delete({ where: { id } });
    }
  };
}
