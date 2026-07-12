import { prisma } from '../client';

/** Watchlist CRUD for the /pattern-scanner page (stateless scanner — no persisted signals). */
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
  };
}
