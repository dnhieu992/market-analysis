import { prisma } from '../client';

export type TradingListPriorityInput = {
  symbol: string;
  /** 0–5 stars. 0 means "no priority". */
  priority: number;
};

export type TradingListNoteInput = {
  symbol: string;
  /** Markdown assessment. Blank means "no note" — the row is removed instead. */
  note: string;
};

/**
 * Per-coin data shared by Bitget and MEXC on /trading-list: star priority,
 * the trader's assessment and the hand-added coins. See the `TradingList*`
 * models in schema.prisma — /bitget and /mexc keep their own tables.
 */
export function createTradingListRepository(client = prisma) {
  return {
    findPriorities() {
      return client.tradingListPriority.findMany({ orderBy: [{ priority: 'desc' }, { symbol: 'asc' }] });
    },

    upsertPriority({ symbol, priority }: TradingListPriorityInput) {
      return client.tradingListPriority.upsert({
        where: { symbol },
        create: { symbol, priority },
        update: { priority },
      });
    },

    findNotes() {
      return client.tradingListNote.findMany({ orderBy: { symbol: 'asc' } });
    },

    upsertNote({ symbol, note }: TradingListNoteInput) {
      return client.tradingListNote.upsert({
        where: { symbol },
        create: { symbol, note },
        update: { note },
      });
    },

    async removeNote(symbol: string): Promise<number> {
      const { count } = await client.tradingListNote.deleteMany({ where: { symbol } });
      return count;
    },

    /** Every coin of /trading-list, oldest first (the order they appear in the list). */
    findWatchlist() {
      return client.tradingListWatchlistSymbol.findMany({ orderBy: { createdAt: 'asc' } });
    },

    /** Idempotent: re-adding a tracked coin returns the existing row (with its exchange availability refreshed when known). */
    addWatchlistSymbol(symbol: string, availability?: { onlyExchange: string | null; exchangesCheckedAt: Date }) {
      return client.tradingListWatchlistSymbol.upsert({
        where: { symbol },
        create: { symbol, ...(availability ?? {}) },
        update: { ...(availability ?? {}) },
      });
    },

    /** Store the result of an exchange-availability check. */
    setWatchlistAvailability(symbol: string, onlyExchange: string | null, exchangesCheckedAt: Date) {
      return client.tradingListWatchlistSymbol.updateMany({ where: { symbol }, data: { onlyExchange, exchangesCheckedAt } });
    },

    async removeWatchlistSymbol(symbol: string): Promise<number> {
      const { count } = await client.tradingListWatchlistSymbol.deleteMany({ where: { symbol } });
      return count;
    },
  };
}
