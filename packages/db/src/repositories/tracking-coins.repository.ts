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

    // ── Journal ──────────────────────────────────────────────────────────

    findJournalByCoin(coinId: string) {
      return client.trackingCoinJournal.findMany({
        where: { coinId },
        orderBy: { date: 'desc' },
      });
    },

    upsertJournalEntry(coinId: string, date: Date, content: string) {
      return client.trackingCoinJournal.upsert({
        where: { coinId_date: { coinId, date } },
        create: { coinId, date, content },
        update: { content },
      });
    },

    // ── Orders ───────────────────────────────────────────────────────────

    upsertOrder(
      coinId: string,
      date: Date,
      type: string,
      data: {
        side: string;
        entryLow: number;
        entryHigh: number;
        tp1: number;
        tp2?: number | null;
        sl: number;
        rrRatio: number;
        rationale: string;
      },
    ) {
      return client.trackingCoinOrder.upsert({
        where: { coinId_date_type: { coinId, date, type } },
        create: { coinId, date, type, ...data },
        update: { ...data },
      });
    },

    findUnresolvedOrders(coinId: string) {
      return client.trackingCoinOrder.findMany({
        where: { coinId, outcome: null },
        orderBy: { date: 'desc' },
      });
    },

    findActiveSwingOrder(coinId: string) {
      return client.trackingCoinOrder.findFirst({
        where: { coinId, type: 'swing', outcome: null },
        orderBy: { date: 'desc' },
      });
    },

    updateOrderEvaluation(
      id: string,
      activated: boolean,
      outcome: string | null,
    ) {
      return client.trackingCoinOrder.update({
        where: { id },
        data: { activated, outcome, evaluatedAt: new Date() },
      });
    },

    findOrdersByCoin(coinId: string, limit = 10) {
      return client.trackingCoinOrder.findMany({
        where: { coinId },
        orderBy: { date: 'desc' },
        take: limit,
      });
    },
  };
}
