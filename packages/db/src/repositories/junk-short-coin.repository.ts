import { prisma } from '../client';

/** CRUD for the /short-junk coin list — the only coins the short-junk skill scans. */
export function createJunkShortCoinRepository(client = prisma) {
  return {
    findAll() {
      return client.junkShortCoin.findMany({ orderBy: { symbol: 'asc' } });
    },

    async symbols(): Promise<string[]> {
      const rows = await client.junkShortCoin.findMany({ select: { symbol: true }, orderBy: { symbol: 'asc' } });
      return rows.map((r) => r.symbol);
    },

    /** Idempotent: re-adding keeps the row; a non-empty note overwrites the old one. */
    upsert(symbol: string, note?: string | null) {
      const n = note?.trim() ? note.trim() : undefined;
      return client.junkShortCoin.upsert({
        where: { symbol },
        create: { symbol, note: n ?? null },
        update: n !== undefined ? { note: n } : {},
      });
    },

    /** Insert the coins not on the list yet (existing rows — and their notes — are left alone). */
    async addMissing(rows: Array<{ symbol: string; note: string | null; source: string }>): Promise<number> {
      if (rows.length === 0) return 0;
      const { count } = await client.junkShortCoin.createMany({ data: rows, skipDuplicates: true });
      return count;
    },

    updateNote(symbol: string, note: string | null) {
      return client.junkShortCoin.update({ where: { symbol }, data: { note: note?.trim() ? note.trim() : null } });
    },

    async remove(symbol: string): Promise<number> {
      const { count } = await client.junkShortCoin.deleteMany({ where: { symbol } });
      return count;
    },
  };
}
