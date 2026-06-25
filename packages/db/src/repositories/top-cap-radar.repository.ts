import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createTopCapRadarRepository(client = prisma) {
  return {
    // ── Coins ──────────────────────────────────────────────────

    findAllCoins() {
      return client.topCapCoin.findMany({ orderBy: { addedAt: 'asc' } });
    },

    findCoinBySymbol(symbol: string) {
      return client.topCapCoin.findUnique({ where: { symbol } });
    },

    addCoin(symbol: string, name = '', marketCap?: number | null) {
      return client.topCapCoin.upsert({
        where: { symbol },
        create: { symbol, name, marketCap: marketCap ?? null },
        update: { name, ...(marketCap !== undefined ? { marketCap } : {}) },
      });
    },

    updateListingDate(symbol: string, listingDate: Date) {
      return client.topCapCoin.update({
        where: { symbol },
        data: { listingDate },
      });
    },

    removeCoin(symbol: string) {
      return client.topCapCoin.delete({ where: { symbol } });
    },

    // ── Signals ────────────────────────────────────────────────

    upsertSignal(
      coinId: string,
      date: Date,
      data: Omit<Prisma.TopCapSignalUncheckedCreateInput, 'id' | 'coinId' | 'date' | 'scannedAt'>,
    ) {
      return client.topCapSignal.upsert({
        where: { coinId_date: { coinId, date } },
        create: { coinId, date, ...data, scannedAt: new Date() },
        update: { ...data, scannedAt: new Date() },
      });
    },

    findLatestSignals(date: Date) {
      return client.topCapSignal.findMany({
        where: { date },
        include: { coin: true },
        orderBy: { signalScore: 'desc' },
      });
    },

    findLatestSignalsByCoin(coinId: string, limit = 1) {
      return client.topCapSignal.findMany({
        where: { coinId },
        orderBy: { date: 'desc' },
        take: limit,
      });
    },

    findCoinsWithLatestSignal() {
      return client.topCapCoin.findMany({
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
