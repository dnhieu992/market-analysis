import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createMemeRadarRepository(client = prisma) {
  return {
    // ── Coins ──────────────────────────────────────────────────

    findAllCoins() {
      return client.memeCoin.findMany({ orderBy: { addedAt: 'asc' } });
    },

    findCoinBySymbol(symbol: string) {
      return client.memeCoin.findUnique({ where: { symbol } });
    },

    addCoin(symbol: string, name = '', marketCap?: number | null) {
      return client.memeCoin.upsert({
        where: { symbol },
        create: { symbol, name, marketCap: marketCap ?? null },
        update: { name, ...(marketCap !== undefined ? { marketCap } : {}) },
      });
    },

    updateListingDate(symbol: string, listingDate: Date) {
      return client.memeCoin.update({
        where: { symbol },
        data: { listingDate },
      });
    },

    removeCoin(symbol: string) {
      return client.memeCoin.delete({ where: { symbol } });
    },

    // ── Signals ────────────────────────────────────────────────

    upsertSignal(
      coinId: string,
      date: Date,
      data: Omit<Prisma.MemeSignalUncheckedCreateInput, 'id' | 'coinId' | 'date' | 'scannedAt'>,
    ) {
      return client.memeSignal.upsert({
        where: { coinId_date: { coinId, date } },
        create: { coinId, date, ...data, scannedAt: new Date() },
        update: { ...data, scannedAt: new Date() },
      });
    },

    findLatestSignals(date: Date) {
      return client.memeSignal.findMany({
        where: { date },
        include: { coin: true },
        orderBy: { signalScore: 'desc' },
      });
    },

    findLatestSignalsByCoin(coinId: string, limit = 1) {
      return client.memeSignal.findMany({
        where: { coinId },
        orderBy: { date: 'desc' },
        take: limit,
      });
    },

    findCoinsWithLatestSignal() {
      return client.memeCoin.findMany({
        include: {
          signals: {
            orderBy: { date: 'desc' },
            take: 1,
          },
        },
        orderBy: { addedAt: 'asc' },
      });
    },

    // ── Signal history (append-only change log) ────────────────

    /**
     * Append a history row only when the radar stage differs from the most
     * recent row for this coin. Returns the new row, or null when unchanged
     * (so daily scans don't bloat the log).
     */
    async logSignalHistoryIfChanged(
      coinId: string,
      data: Omit<Prisma.MemeSignalHistoryUncheckedCreateInput, 'id' | 'coinId' | 'scannedAt'>,
    ) {
      const last = await client.memeSignalHistory.findFirst({
        where: { coinId },
        orderBy: { scannedAt: 'desc' },
        select: { stage: true },
      });
      if (last && last.stage === data.stage) {
        return null; // no stage change → skip
      }
      return client.memeSignalHistory.create({
        data: { coinId, ...data, scannedAt: new Date() },
      });
    },

    findSignalHistory(coinId: string, limit = 100) {
      return client.memeSignalHistory.findMany({
        where: { coinId },
        orderBy: { scannedAt: 'desc' },
        take: limit,
      });
    },

    deleteCoinsNotInSymbols(symbols: string[]) {
      if (symbols.length === 0) return client.memeCoin.deleteMany({});
      return client.memeCoin.deleteMany({
        where: { symbol: { notIn: symbols } },
      });
    },
  };
}
