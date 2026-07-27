import { prisma } from '../client';

export type BitgetSymbolPriorityInput = {
  symbol: string;
  /** 0–5 stars. 0 means "no priority" (all stars grey in the Setup tab). */
  priority: number;
};

/**
 * Manual star priority per coin for the /bitget Setup tab. One row per symbol —
 * the tab sorts by it (highest first) on open. See the `BitgetSymbolPriority`
 * model in schema.prisma.
 */
export function createBitgetSymbolPriorityRepository(client = prisma) {
  return {
    /** Every saved priority, for hydrating the whole Setup tab at once. */
    findAll() {
      return client.bitgetSymbolPriority.findMany({
        orderBy: [{ priority: 'desc' }, { symbol: 'asc' }],
      });
    },

    /** Insert or update the star rating of one coin. */
    upsert({ symbol, priority }: BitgetSymbolPriorityInput) {
      return client.bitgetSymbolPriority.upsert({
        where: { symbol },
        create: { symbol, priority },
        update: { priority },
      });
    },
  };
}
