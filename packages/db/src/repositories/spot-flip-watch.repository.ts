import { prisma } from '../client';

export function createSpotFlipWatchRepository(client = prisma) {
  return {
    // Only the active coins — soft-deleted rows (disabledAt set) stay hidden.
    findAll() {
      return client.spotFlipWatch.findMany({
        where: { disabledAt: null },
        orderBy: { addedAt: 'asc' },
      });
    },

    // Adding (or re-adding) a coin always re-activates it: disabledAt → null.
    add(symbol: string, name = '') {
      return client.spotFlipWatch.upsert({
        where: { symbol },
        create: { symbol, name },
        update: { name, disabledAt: null },
      });
    },

    // Soft delete: keep the row, just mark it disabled so it drops out of the
    // watchlist without losing the record.
    remove(symbol: string) {
      return client.spotFlipWatch.update({
        where: { symbol },
        data: { disabledAt: new Date() },
      });
    },
  };
}
