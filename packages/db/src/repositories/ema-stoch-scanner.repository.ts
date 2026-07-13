import { prisma } from '../client';

export type EmaStochSignalUpsert = {
  symbol: string;
  triggeredAt: Date;
  entryPrice: number;
  tpPrice: number;
  distPct: number;
  rsi?: number | null;
  stochK?: number | null;
  stochD?: number | null;
  ema34?: number | null;
  ema89?: number | null;
  ema200?: number | null;
  currentPrice?: number | null;
  pnlPct?: number | null;
};

/** Watchlist + persisted-signal CRUD for the /ema-bounce scanner (worker auto-scans every 4h). */
export function createEmaStochScannerRepository(client = prisma) {
  return {
    // ── watchlist ──────────────────────────────────────────────
    findAllCoins() {
      return client.emaStochWatchCoin.findMany({ orderBy: { addedAt: 'asc' } });
    },

    findCoinBySymbol(symbol: string) {
      return client.emaStochWatchCoin.findUnique({ where: { symbol } });
    },

    addCoin(symbol: string, name = '') {
      return client.emaStochWatchCoin.upsert({
        where: { symbol },
        create: { symbol, name },
        update: { name },
      });
    },

    removeCoin(symbol: string) {
      return client.emaStochWatchCoin.delete({ where: { symbol } });
    },

    // ── signals (cards) ────────────────────────────────────────
    /** All signals newest-first, optionally only open ones. */
    findSignals(onlyOpen = false) {
      return client.emaStochSignal.findMany({
        where: onlyOpen ? { status: 'open' } : undefined,
        orderBy: { triggeredAt: 'desc' },
      });
    },

    findOpenSignals() {
      return client.emaStochSignal.findMany({ where: { status: 'open' } });
    },

    findOpenSignalsByCoin(coinId: string) {
      return client.emaStochSignal.findMany({ where: { coinId, status: 'open' } });
    },

    findSignalByCoinAndTime(coinId: string, triggeredAt: Date) {
      return client.emaStochSignal.findUnique({
        where: { coinId_triggeredAt: { coinId, triggeredAt } },
      });
    },

    /**
     * Insert a freshly triggered signal. Returns { created: false } if a card for the
     * same coin+candle already exists (idempotent — safe to re-run a scan).
     */
    async createSignalIfNew(coinId: string, input: EmaStochSignalUpsert): Promise<{ created: boolean; id: string }> {
      const existing = await client.emaStochSignal.findUnique({
        where: { coinId_triggeredAt: { coinId, triggeredAt: input.triggeredAt } },
      });
      if (existing) return { created: false, id: existing.id };
      const row = await client.emaStochSignal.create({
        data: {
          coinId,
          symbol: input.symbol,
          triggeredAt: input.triggeredAt,
          status: 'open',
          entryPrice: input.entryPrice,
          tpPrice: input.tpPrice,
          distPct: input.distPct,
          rsi: input.rsi ?? null,
          stochK: input.stochK ?? null,
          stochD: input.stochD ?? null,
          ema34: input.ema34 ?? null,
          ema89: input.ema89 ?? null,
          ema200: input.ema200 ?? null,
          currentPrice: input.currentPrice ?? input.entryPrice,
          pnlPct: input.pnlPct ?? 0,
          lastCheckedAt: new Date(),
        },
      });
      return { created: true, id: row.id };
    },

    /** Refresh an open card's mark-to-market fields. */
    updateSignalMark(id: string, currentPrice: number, pnlPct: number) {
      return client.emaStochSignal.update({
        where: { id },
        data: { currentPrice, pnlPct, lastCheckedAt: new Date() },
      });
    },

    /** Close a card as TP-hit. */
    markSignalHitTp(id: string, currentPrice: number, pnlPct: number, hitTpAt: Date) {
      return client.emaStochSignal.update({
        where: { id },
        data: { status: 'hit_tp', currentPrice, pnlPct, hitTpAt, lastCheckedAt: new Date() },
      });
    },
  };
}
