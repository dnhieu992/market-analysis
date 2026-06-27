import { prisma } from '../client';

/** Repository for the BTC DCA dip-bounce ladder (manual tracking). */
export function createDcaLadderRepository(client = prisma) {
  return {
    async getSettings() {
      const existing = await client.dcaLadderSettings.findUnique({ where: { id: 'singleton' } });
      if (existing) return existing;
      return client.dcaLadderSettings.create({ data: { id: 'singleton' } });
    },

    updateSettings(data: {
      startCapital?: number;
      firstTierPct?: number;
      numTiers?: number;
      stepPct?: number;
      tpPct?: number;
      feePct?: number;
      enabled?: boolean;
    }) {
      return client.dcaLadderSettings.update({ where: { id: 'singleton' }, data });
    },

    getCurrentCycle(symbol: string) {
      return client.dcaCycle.findFirst({
        where: { symbol, status: { not: 'CLOSED' } },
        orderBy: { cycleNumber: 'desc' },
      });
    },

    getCycleWithOrders(cycleId: string) {
      return client.dcaCycle.findUnique({
        where: { id: cycleId },
        include: { orders: { orderBy: [{ side: 'asc' }, { tierIndex: 'asc' }] } },
      });
    },

    createCycle(data: {
      symbol: string;
      cycleNumber: number;
      status: string;
      peak: number;
      budget: number;
    }) {
      return client.dcaCycle.create({ data });
    },

    updateCycle(
      id: string,
      data: {
        status?: string;
        peak?: number;
        budget?: number;
        avgCost?: number | null;
        positionSize?: number | null;
        tpPrice?: number | null;
        realizedPnl?: number | null;
        closedAt?: Date | null;
      },
    ) {
      return client.dcaCycle.update({ where: { id }, data });
    },

    async createOrders(
      orders: Array<{
        cycleId: string;
        side: string;
        tierIndex: number | null;
        plannedPrice: number;
        usdAmount: number | null;
        status: string;
      }>,
    ) {
      await client.dcaOrder.createMany({ data: orders });
    },

    async deleteOrdersByCycle(cycleId: string) {
      await client.dcaOrder.deleteMany({ where: { cycleId } });
    },

    getOrdersByCycle(cycleId: string) {
      return client.dcaOrder.findMany({
        where: { cycleId },
        orderBy: [{ side: 'asc' }, { tierIndex: 'asc' }],
      });
    },

    getOrder(id: string) {
      return client.dcaOrder.findUnique({ where: { id } });
    },

    updateOrder(
      id: string,
      data: {
        plannedPrice?: number;
        fillPrice?: number | null;
        qty?: number | null;
        status?: string;
        filledAt?: Date | null;
      },
    ) {
      return client.dcaOrder.update({ where: { id }, data });
    },

    listClosedCycles(symbol: string) {
      return client.dcaCycle.findMany({
        where: { symbol, status: 'CLOSED' },
        orderBy: { cycleNumber: 'asc' },
      });
    },

    listAllCycles(symbol: string) {
      return client.dcaCycle.findMany({ where: { symbol }, orderBy: { cycleNumber: 'asc' } });
    },
  };
}
