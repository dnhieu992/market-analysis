import { prisma } from '../client';

export function createSpotFlipWatchRepository(client = prisma) {
  return {
    findAll() {
      return client.spotFlipWatch.findMany({ orderBy: { addedAt: 'asc' } });
    },

    add(symbol: string, name = '') {
      return client.spotFlipWatch.upsert({
        where: { symbol },
        create: { symbol, name },
        update: { name },
      });
    },

    remove(symbol: string) {
      return client.spotFlipWatch.delete({ where: { symbol } });
    },
  };
}
