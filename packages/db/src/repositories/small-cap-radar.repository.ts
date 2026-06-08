import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createSmallCapRadarRepository(client = prisma) {
  return {
    // ── Coins ──────────────────────────────────────────────────

    findAllCoins() {
      return client.smallCapCoin.findMany({ orderBy: { addedAt: 'asc' } });
    },

    findCoinBySymbol(symbol: string) {
      return client.smallCapCoin.findUnique({ where: { symbol } });
    },

    addCoin(symbol: string, name = '', marketCap?: number | null) {
      return client.smallCapCoin.upsert({
        where: { symbol },
        create: { symbol, name, marketCap: marketCap ?? null },
        update: { name, ...(marketCap !== undefined ? { marketCap } : {}) },
      });
    },

    updateListingDate(symbol: string, listingDate: Date) {
      return client.smallCapCoin.update({
        where: { symbol },
        data: { listingDate },
      });
    },

    removeCoin(symbol: string) {
      return client.smallCapCoin.delete({ where: { symbol } });
    },

    // ── Signals ────────────────────────────────────────────────

    upsertSignal(
      coinId: string,
      date: Date,
      data: Omit<Prisma.SmallCapSignalUncheckedCreateInput, 'id' | 'coinId' | 'date' | 'scannedAt'>,
    ) {
      return client.smallCapSignal.upsert({
        where: { coinId_date: { coinId, date } },
        create: { coinId, date, ...data, scannedAt: new Date() },
        update: { ...data, scannedAt: new Date() },
      });
    },

    findLatestSignals(date: Date) {
      return client.smallCapSignal.findMany({
        where: { date },
        include: { coin: true },
        orderBy: { signalScore: 'desc' },
      });
    },

    findLatestSignalsByCoin(coinId: string, limit = 1) {
      return client.smallCapSignal.findMany({
        where: { coinId },
        orderBy: { date: 'desc' },
        take: limit,
      });
    },

    findCoinsWithLatestSignal() {
      return client.smallCapCoin.findMany({
        include: {
          signals: {
            orderBy: { date: 'desc' },
            take: 1,
          },
        },
        orderBy: { addedAt: 'asc' },
      });
    },

    deleteCoinsNotInSymbols(symbols: string[]) {
      if (symbols.length === 0) return client.smallCapCoin.deleteMany({});
      return client.smallCapCoin.deleteMany({
        where: { symbol: { notIn: symbols } },
      });
    },
  };
}
