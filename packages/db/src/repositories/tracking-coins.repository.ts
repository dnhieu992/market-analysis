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
        positionSize?: number | null;
        positionValue?: number | null;
      },
    ) {
      // notes is intentionally excluded from update to preserve user edits
      const { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale, positionSize, positionValue } = data;
      return client.trackingCoinOrder.upsert({
        where: { coinId_date_type: { coinId, date, type } },
        create: { coinId, date, type, ...data },
        update: { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale, positionSize, positionValue },
      });
    },

    updateOrderNotes(id: string, notes: string | null) {
      return client.trackingCoinOrder.update({ where: { id }, data: { notes } });
    },

    // Remove a day's order of a given type (used when the regime turns no-trade,
    // so a stale order from an earlier scan does not linger). No-op if absent.
    deleteOrder(coinId: string, date: Date, type: string) {
      return client.trackingCoinOrder.deleteMany({ where: { coinId, date, type } });
    },

    findOrdersByDate(coinId: string, date: Date) {
      return client.trackingCoinOrder.findMany({
        where: { coinId, date },
        orderBy: { type: 'asc' },
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

    findOrdersByCoin(coinId: string) {
      return client.trackingCoinOrder.findMany({
        where: { coinId },
        orderBy: { date: 'desc' },
      });
    },
  };
}
