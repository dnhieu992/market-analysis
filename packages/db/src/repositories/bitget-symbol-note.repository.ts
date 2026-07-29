import { prisma } from '../client';

export type BitgetSymbolNoteInput = {
  symbol: string;
  /** Markdown assessment. Blank means "no note" — the row is removed instead. */
  note: string;
};

/**
 * The trader's free-text assessment per coin in the /bitget Setup tab. One row
 * per symbol. See the `BitgetSymbolNote` model in schema.prisma.
 */
export function createBitgetSymbolNoteRepository(client = prisma) {
  return {
    /** Every saved note, for hydrating the whole Setup tab at once. */
    findAll() {
      return client.bitgetSymbolNote.findMany({ orderBy: { symbol: 'asc' } });
    },

    /** Insert or replace one coin's note. */
    upsert({ symbol, note }: BitgetSymbolNoteInput) {
      return client.bitgetSymbolNote.upsert({
        where: { symbol },
        create: { symbol, note },
        update: { note },
      });
    },

    /** Drop a coin's note (used when the trader clears the text). */
    async remove(symbol: string): Promise<number> {
      const { count } = await client.bitgetSymbolNote.deleteMany({ where: { symbol } });
      return count;
    },
  };
}
