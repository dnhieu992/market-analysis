import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createTrackingCoinsRepository(client = prisma) {
  return {
    findAllCoins() {
      return client.trackingCoin.findMany({ orderBy: { addedAt: 'asc' } });
    },

    findCoinBySymbol(symbol: string) {
      return client.trackingCoin.findUnique({ where: { symbol } });
    },

    addCoin(symbol: string, name = '') {
      return client.trackingCoin.upsert({
        where: { symbol },
        create: { symbol, name },
        update: { name },
      });
    },

    removeCoin(symbol: string) {
      return client.trackingCoin.delete({ where: { symbol } });
    },

    upsertSignal(
      coinId: string,
      date: Date,
      data: Omit<Prisma.TrackingCoinSignalUncheckedCreateInput, 'id' | 'coinId' | 'date' | 'scannedAt'>,
    ) {
      return client.trackingCoinSignal.upsert({
        where: { coinId_date: { coinId, date } },
        create: { coinId, date, ...data, scannedAt: new Date() },
        update: { ...data, scannedAt: new Date() },
      });
    },

    findCoinsWithLatestSignal() {
      return client.trackingCoin.findMany({
        include: {
          signals: {
            orderBy: { date: 'desc' },
            take: 1,
          },
        },
        orderBy: { addedAt: 'asc' },
      });
    },
  };
}
