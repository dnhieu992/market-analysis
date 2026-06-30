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

    // ── DCA signal history (append-only change log) ────────────────────────

    /**
     * Append a history row only when the DCA action zone OR quality bucket
     * differs from the most recent row for this coin. Returns the new row, or
     * null when nothing changed (so 4-hour scans don't bloat the log).
     */
    async logSignalHistoryIfChanged(
      coinId: string,
      data: Omit<Prisma.TrackingCoinSignalHistoryUncheckedCreateInput, 'id' | 'coinId' | 'scannedAt'>,
    ) {
      const last = await client.trackingCoinSignalHistory.findFirst({
        where: { coinId },
        orderBy: { scannedAt: 'desc' },
        select: { dcaZone: true, dcaBucket: true },
      });
      const zone = data.dcaZone ?? null;
      if (last && last.dcaZone === zone && last.dcaBucket === data.dcaBucket) {
        return null; // no meaningful change → skip
      }
      return client.trackingCoinSignalHistory.create({
        data: { coinId, ...data, scannedAt: new Date() },
      });
    },

    findSignalHistory(coinId: string, limit = 100) {
      return client.trackingCoinSignalHistory.findMany({
        where: { coinId },
        orderBy: { scannedAt: 'desc' },
        take: limit,
      });
    },

    /** Latest signal snapshot for a single coin (used to derive a buy's entry mode). */
    findLatestSignal(coinId: string) {
      return client.trackingCoinSignal.findFirst({
        where: { coinId },
        orderBy: { date: 'desc' },
      });
    },

    /** True when a daily LLM holding-review row already exists for this coin since `since`. */
    async hasHoldingReviewSince(coinId: string, since: Date) {
      const row = await client.trackingCoinSignalHistory.findFirst({
        where: { coinId, llmVerdict: { not: null }, scannedAt: { gte: since } },
        select: { id: true },
      });
      return row != null;
    },

    /** Append a daily LLM holding-review row to the signal-history feed. */
    appendHoldingReview(
      coinId: string,
      data: Omit<Prisma.TrackingCoinSignalHistoryUncheckedCreateInput, 'id' | 'coinId' | 'scannedAt'>,
    ) {
      return client.trackingCoinSignalHistory.create({
        data: { coinId, ...data, scannedAt: new Date() },
      });
    },

    findCoinsWithLatestSignal() {
      return client.trackingCoin.findMany({
        include: {
          signals: {
            orderBy: { date: 'desc' },
            take: 1,
          },
          dcaBuys: { orderBy: { boughtAt: 'asc' } },
        },
        // Market cap desc (MySQL sorts NULL last on DESC), then insertion order.
        orderBy: [{ marketCap: 'desc' }, { addedAt: 'asc' }],
      });
    },

    // ── DCA position (manual buy log) ──────────────────────────────────────

    findDcaBuysByCoin(coinId: string) {
      return client.trackingCoinDcaBuy.findMany({
        where: { coinId },
        orderBy: { boughtAt: 'asc' },
      });
    },

    findDcaBuyById(id: string) {
      return client.trackingCoinDcaBuy.findUnique({ where: { id } });
    },

    addDcaBuy(
      coinId: string,
      data: { price: number; usd: number; entryMode?: string | null; boughtAt?: Date; portfolioId?: string | null; transactionId?: string | null },
    ) {
      return client.trackingCoinDcaBuy.create({
        data: {
          coinId,
          price: data.price,
          usd: data.usd,
          ...(data.entryMode !== undefined ? { entryMode: data.entryMode } : {}),
          ...(data.boughtAt ? { boughtAt: data.boughtAt } : {}),
          ...(data.portfolioId !== undefined ? { portfolioId: data.portfolioId } : {}),
          ...(data.transactionId !== undefined ? { transactionId: data.transactionId } : {}),
        },
      });
    },

    deleteDcaBuy(id: string) {
      return client.trackingCoinDcaBuy.delete({ where: { id } });
    },

    deleteAllDcaBuys(coinId: string) {
      return client.trackingCoinDcaBuy.deleteMany({ where: { coinId } });
    },

    /** Reverse sync: drop any DCA layer mirrored by a (now-deleted) portfolio transaction. */
    deleteDcaBuysByTransactionId(transactionId: string) {
      return client.trackingCoinDcaBuy.deleteMany({ where: { transactionId } });
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
        dcaMaxLayers?: number | null;
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
