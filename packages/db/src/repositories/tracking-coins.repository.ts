import { prisma } from '../client';

export function createTrackingCoinsRepository(client = prisma) {
  return {
    findAllCoins() {
      return client.trackingCoin.findMany({ orderBy: { addedAt: 'asc' } });
    },

    /** The watchlist in page order: market cap desc (MySQL sorts NULL last on DESC), then insertion order. */
    listCoins() {
      return client.trackingCoin.findMany({ orderBy: [{ marketCap: 'desc' }, { addedAt: 'asc' }] });
    },

    findCoinBySymbol(symbol: string) {
      return client.trackingCoin.findUnique({ where: { symbol } });
    },

    addCoin(symbol: string, name = '', marketCap?: number | null) {
      return client.trackingCoin.upsert({
        where: { symbol },
        create: { symbol, name, marketCap: marketCap ?? null },
        update: { name, ...(marketCap !== undefined ? { marketCap } : {}) },
      });
    },

    removeCoin(symbol: string) {
      return client.trackingCoin.delete({ where: { symbol } });
    },

    updateCoinSetup(
      coinId: string,
      data: {
        swingMaxLoss?: number | null;
        swingMinRR?: number | null;
        daytradeMaxLoss?: number | null;
        daytradeMinRR?: number | null;
      },
    ) {
      return client.trackingCoin.update({ where: { id: coinId }, data });
    },
  };
}
