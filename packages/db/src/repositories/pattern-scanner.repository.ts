import { prisma } from '../client';

/** Watchlist + reference-image CRUD for the /pattern-scanner page (stateless scanner — no persisted signals). */
export function createPatternScannerRepository(client = prisma) {
  return {
    findAllCoins() {
      return client.patternWatchCoin.findMany({ orderBy: { addedAt: 'asc' } });
    },

    findCoinBySymbol(symbol: string) {
      return client.patternWatchCoin.findUnique({ where: { symbol } });
    },

    addCoin(symbol: string, name = '') {
      return client.patternWatchCoin.upsert({
        where: { symbol },
        create: { symbol, name },
        update: { name },
      });
    },

    removeCoin(symbol: string) {
      return client.patternWatchCoin.delete({ where: { symbol } });
    },

    findReferencesByPattern(pattern: string) {
      return client.patternReferenceImage.findMany({
        where: { pattern },
        orderBy: { createdAt: 'desc' },
      });
    },

    findReferenceById(id: string) {
      return client.patternReferenceImage.findUnique({ where: { id } });
    },

    addReference(pattern: string, imageUrl: string, r2Key?: string, notes?: string) {
      return client.patternReferenceImage.create({
        data: { pattern, imageUrl, r2Key, notes },
      });
    },

    removeReference(id: string) {
      return client.patternReferenceImage.delete({ where: { id } });
    },
  };
}
