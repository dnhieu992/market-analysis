import { prisma } from '../client';

/** Default corpus — the /journal page. STRATEGY_BACKTEST is the setup-analysis notes. */
export const DEFAULT_JOURNAL_SCOPE = 'GENERAL';

export type TradingJournalUpsert = {
  scope?: string;
  date: Date;
  content: string;
  images?: string[];
  tags?: string[];
};

/** Two snapshots are the same save if content, images and tags all match (order included). */
function sameSnapshot(
  a: { content: string; images: unknown; tags: unknown },
  b: { content: string; images: string[]; tags: string[] },
): boolean {
  return (
    a.content === b.content &&
    JSON.stringify(a.images) === JSON.stringify(b.images) &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags)
  );
}

/** CRUD for the daily trading journal (/journal). One entry per calendar day, keyed by `date`. */
export function createTradingJournalRepository(client = prisma) {
  return {
    /** All entries in a scope, newest day first. */
    findAll(scope: string = DEFAULT_JOURNAL_SCOPE) {
      return client.tradingJournalEntry.findMany({ where: { scope }, orderBy: { date: 'desc' } });
    },

    findByDate(date: Date, scope: string = DEFAULT_JOURNAL_SCOPE) {
      return client.tradingJournalEntry.findUnique({ where: { scope_date: { scope, date } } });
    },

    findById(id: string) {
      return client.tradingJournalEntry.findUnique({ where: { id } });
    },

    /** Intra-day snapshots for one day, newest first. */
    findRevisionsByEntryId(entryId: string) {
      return client.tradingJournalRevision.findMany({
        where: { entryId },
        orderBy: { createdAt: 'desc' },
      });
    },

    /**
     * Create or update the entry for a day (one journal per calendar date) and snapshot the
     * result as a revision, so each save during the day stays traceable. A save that changes
     * nothing does not add a revision.
     */
    upsertByDate(input: TradingJournalUpsert) {
      const images = input.images ?? [];
      const tags = input.tags ?? [];
      const scope = input.scope ?? DEFAULT_JOURNAL_SCOPE;
      return client.$transaction(async (tx) => {
        const entry = await tx.tradingJournalEntry.upsert({
          where: { scope_date: { scope, date: input.date } },
          create: { scope, date: input.date, content: input.content, images, tags },
          update: { content: input.content, images, tags },
        });

        const latest = await tx.tradingJournalRevision.findFirst({
          where: { entryId: entry.id },
          orderBy: { createdAt: 'desc' },
        });

        if (!latest || !sameSnapshot(latest, { content: input.content, images, tags })) {
          await tx.tradingJournalRevision.create({
            data: { entryId: entry.id, content: input.content, images, tags },
          });
        }

        return entry;
      });
    },

    /** Deletes the day and, via the FK cascade, its revisions. */
    deleteById(id: string) {
      return client.tradingJournalEntry.delete({ where: { id } });
    },
  };
}
