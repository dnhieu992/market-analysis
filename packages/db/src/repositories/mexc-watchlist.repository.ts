import { prisma } from '../client';

/**
 * Coins the trader added to the /mexc Setup tab by hand. One row per symbol —
 * the tab merges these with its hardcoded pins/watchlist and every coin ever
 * traded. See the `MexcWatchlistSymbol` model in schema.prisma.
 */
export function createMexcWatchlistRepository(client = prisma) {
  return {
    /** Every manually added coin, oldest first (the order they appear in the tab). */
    findAll() {
      return client.mexcWatchlistSymbol.findMany({ orderBy: { createdAt: 'asc' } });
    },

    /**
     * Add a coin. Idempotent: re-adding one that is already tracked returns the
     * existing row instead of failing on the unique index.
     */
    add(symbol: string) {
      return client.mexcWatchlistSymbol.upsert({
        where: { symbol },
        create: { symbol },
        update: {},
      });
    },

    /** Remove a coin. Returns how many rows went away (0 when it wasn't tracked). */
    async remove(symbol: string): Promise<number> {
      const { count } = await client.mexcWatchlistSymbol.deleteMany({ where: { symbol } });
      return count;
    },
  };
}
