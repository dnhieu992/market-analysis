import { prisma } from '../client';

export type OkxTradeJournalSnapshot = {
  markPrice?: number;
  entryPrice?: number;
  roePct?: number;
  unrealizedPnlUsd?: number;
  /** Day-open (00:00 UTC) reference price used to compute `dayOpenChangePct`. */
  dayOpenPrice?: number;
  /** % change of the log's reference price vs the day-open price (same calc as the Setup tab's "Hôm nay" column). */
  dayOpenChangePct?: number;
};

export type OkxTradeJournalInput = {
  tradeKey: string;
  symbol: string;
  holdSide: string;
  content: string;
  images?: string[];
  snapshot?: OkxTradeJournalSnapshot | null;
  /** "manual" (trader note, default) or "system" (auto open/close event). */
  kind?: 'manual' | 'system';
};

/**
 * Append-only timeline of manual notes for one OKX trade session (a live
 * position), keyed by `tradeKey`. Each save is a new row — the ordered list of
 * notes is the record of how the trade was watched. See the `OkxTradeJournal`
 * model in schema.prisma.
 */
export function createOkxTradeJournalRepository(client = prisma) {
  return {
    /** All notes for one trade session, oldest first (chronological timeline). */
    findByTradeKey(tradeKey: string) {
      return client.okxTradeJournal.findMany({
        where: { tradeKey },
        orderBy: { createdAt: 'asc' },
      });
    },

    findById(id: string) {
      return client.okxTradeJournal.findUnique({ where: { id } });
    },

    create(input: OkxTradeJournalInput) {
      return client.okxTradeJournal.create({
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
      return client.okxTradeJournal.update({
        where: { id },
        data: { content: input.content, images: input.images ?? [] },
      });
    },

    deleteById(id: string) {
      return client.okxTradeJournal.delete({ where: { id } });
    },
  };
}
