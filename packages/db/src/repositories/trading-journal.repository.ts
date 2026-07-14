import { prisma } from '../client';

export type TradingJournalUpsert = {
  date: Date;
  content: string;
  images?: string[];
  tags?: string[];
};

/** CRUD for the daily trading journal (/journal). One entry per calendar day, keyed by `date`. */
export function createTradingJournalRepository(client = prisma) {
  return {
    /** All entries, newest day first. */
    findAll() {
      return client.tradingJournalEntry.findMany({ orderBy: { date: 'desc' } });
    },

    findByDate(date: Date) {
      return client.tradingJournalEntry.findUnique({ where: { date } });
    },

    findById(id: string) {
      return client.tradingJournalEntry.findUnique({ where: { id } });
    },

    /** Create or update the entry for a day (one journal per calendar date). */
    upsertByDate(input: TradingJournalUpsert) {
      const images = input.images ?? [];
      const tags = input.tags ?? [];
      return client.tradingJournalEntry.upsert({
        where: { date: input.date },
        create: { date: input.date, content: input.content, images, tags },
        update: { content: input.content, images, tags },
      });
    },

    deleteById(id: string) {
      return client.tradingJournalEntry.delete({ where: { id } });
    },
  };
}
