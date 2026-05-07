import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type ListFilteredParams = {
  symbol?: string;
  status?: string;
  brokers?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
};

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
    async listFiltered(params: ListFilteredParams) {
      const where: Prisma.OrderWhereInput = {};
      if (params.symbol) where.symbol = { contains: params.symbol };
      if (params.status) where.status = params.status;
      if (params.brokers?.length) where.broker = { in: params.brokers };
      if (params.dateFrom ?? params.dateTo) {
        where.openedAt = {
          ...(params.dateFrom ? { gte: params.dateFrom } : {}),
          ...(params.dateTo ? { lte: params.dateTo } : {}),
        };
      }

      const skip = (params.page - 1) * params.pageSize;

      const [data, total, closedAgg, openOrders] = await Promise.all([
        client.order.findMany({
          where,
          orderBy: { openedAt: 'desc' },
          skip,
          take: params.pageSize,
        }),
        client.order.count({ where }),
        client.order.aggregate({
          where: { ...where, status: 'closed' },
          _sum: { pnl: true },
        }),
        params.status === 'closed'
          ? Promise.resolve([])
          : client.order.findMany({
              where: { ...where, status: 'open' },
              orderBy: { openedAt: 'desc' },
            }),
      ]);

      return {
        data,
        total,
        closedPnlSum: closedAgg._sum.pnl ?? 0,
        openOrders,
      };
    },
    async listDistinctBrokers() {
      const result = await client.order.groupBy({
        by: ['broker'],
        where: { broker: { not: null } },
        orderBy: { broker: 'asc' },
      });
      return result.map((r) => r.broker as string);
    },
    update(id: string, data: Prisma.OrderUncheckedUpdateInput) {
      return client.order.update({
        where: { id },
        data
      });
    },
    remove(id: string) {
      return client.order.delete({ where: { id } });
    }
  };
}
