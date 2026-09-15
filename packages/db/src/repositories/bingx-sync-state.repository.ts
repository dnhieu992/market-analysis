import { prisma } from '../client';

const SINGLETON_ID = 'singleton';

/**
 * Singleton state for the read-only BingX order sync.
 *  - `historyStartAt` — set once on the first sync = the moment collecting begins.
 *    Only positions opened from that point are ingested (no historical backfill).
 *  - `baseline` — externalIds already open at that first sync, permanently ignored
 *    as "past" trades.
 */
export function createBingxSyncStateRepository(client = prisma) {
  return {
    /** The full state row (null before the first sync). */
    async get(): Promise<{ historyStartAt: Date | null; baseline: string[] } | null> {
      const row = await client.bingxSyncState.findUnique({
        where: { id: SINGLETON_ID },
        select: { historyStartAt: true, baseline: true },
      });
      if (!row) return null;
      return {
        historyStartAt: row.historyStartAt ?? null,
        baseline: Array.isArray(row.baseline) ? (row.baseline as string[]) : [],
      };
    },

    /** Anchor the sync on first run: record the start time + the pre-existing
     *  open externalIds to ignore. Upserts the singleton row. */
    async anchor(startAt: Date, baseline: string[]): Promise<void> {
      await client.bingxSyncState.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, historyStartAt: startAt, baseline },
        update: { historyStartAt: startAt, baseline },
      });
    },
  };
}
