import { prisma } from '../client';

export type OkxSymbolPriorityInput = {
  symbol: string;
  /** 0–5 stars. 0 means "no priority" (all stars grey in the Setup tab). */
  priority: number;
};

/**
 * Manual star priority per coin for the /okx Setup tab. One row per symbol —
 * the tab sorts by it (highest first) on open. See the `OkxSymbolPriority`
 * model in schema.prisma.
 */
export function createOkxSymbolPriorityRepository(client = prisma) {
  return {
    /** Every saved priority, for hydrating the whole Setup tab at once. */
    findAll() {
      return client.okxSymbolPriority.findMany({
        orderBy: [{ priority: 'desc' }, { symbol: 'asc' }],
      });
    },

    /** Insert or update the star rating of one coin. */
    upsert({ symbol, priority }: OkxSymbolPriorityInput) {
      return client.okxSymbolPriority.upsert({
        where: { symbol },
        create: { symbol, priority },
        update: { priority },
      });
    },
  };
}
