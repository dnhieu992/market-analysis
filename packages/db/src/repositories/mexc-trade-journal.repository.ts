import { prisma } from '../client';

export type MexcTradeJournalSnapshot = {
  markPrice?: number;
  entryPrice?: number;
  roePct?: number;
  unrealizedPnlUsd?: number;
  /** Day-open (00:00 UTC) reference price used to compute `dayOpenChangePct`. */
  dayOpenPrice?: number;
  /** % change of the log's reference price vs the day-open price (same calc as the Setup tab's "Hôm nay" column). */
  dayOpenChangePct?: number;
};

export type MexcTradeJournalInput = {
  tradeKey: string;
  symbol: string;
  holdSide: string;
  content: string;
  images?: string[];
  snapshot?: MexcTradeJournalSnapshot | null;
  /** "manual" (trader note, default) or "system" (auto open/close event). */
  kind?: 'manual' | 'system';
};

/**
 * Append-only timeline of manual notes for one MEXC trade session (a live
 * position), keyed by `tradeKey`. Each save is a new row — the ordered list of
 * notes is the record of how the trade was watched. See the `MexcTradeJournal`
 * model in schema.prisma.
 */
export function createMexcTradeJournalRepository(client = prisma) {
  return {
    /** All notes for one trade session, oldest first (chronological timeline). */
    findByTradeKey(tradeKey: string) {
      return client.mexcTradeJournal.findMany({
        where: { tradeKey },
        orderBy: { createdAt: 'asc' },
      });
    },

    findById(id: string) {
      return client.mexcTradeJournal.findUnique({ where: { id } });
    },

    create(input: MexcTradeJournalInput) {
      return client.mexcTradeJournal.create({
        data: {
          tradeKey: input.tradeKey,
          kind: input.kind ?? 'manual',
          symbol: input.symbol,
          holdSide: input.holdSide,
          content: input.content,
          images: input.images ?? [],
          snapshot: input.snapshot ?? undefined,
        },
      });
    },

    update(id: string, input: { content: string; images?: string[] }) {
      return client.mexcTradeJournal.update({
        where: { id },
        data: { content: input.content, images: input.images ?? [] },
      });
    },

    deleteById(id: string) {
      return client.mexcTradeJournal.delete({ where: { id } });
    },
  };
}
