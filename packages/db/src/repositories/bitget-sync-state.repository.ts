import { prisma } from '../client';

const SINGLETON_ID = 'singleton';

/**
 * Singleton state for the Bitget closed-trade sync. Holds `historyStartAt` — the
 * floor of the trade log, anchored once to when the current live positions were
 * opened so the /bitget history tab records only from that point forward.
 */
export function createBitgetSyncStateRepository(client = prisma) {
  return {
    /** The anchored history-start floor, or null if not yet set. */
    async getHistoryStartAt(): Promise<Date | null> {
      const row = await client.bitgetSyncState.findUnique({
        where: { id: SINGLETON_ID },
        select: { historyStartAt: true },
      });
      return row?.historyStartAt ?? null;
    },

    /** Anchor the history-start floor. Upserts the singleton row. */
    async setHistoryStartAt(date: Date): Promise<void> {
      await client.bitgetSyncState.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, historyStartAt: date },
        update: { historyStartAt: date },
      });
    },
  };
}
