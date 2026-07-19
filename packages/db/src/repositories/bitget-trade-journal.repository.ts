import { prisma } from '../client';

export type BitgetTradeJournalSnapshot = {
  markPrice?: number;
  entryPrice?: number;
  roePct?: number;
  unrealizedPnlUsd?: number;
};

export type BitgetTradeJournalInput = {
  tradeKey: string;
  symbol: string;
  holdSide: string;
  content: string;
  images?: string[];
  snapshot?: BitgetTradeJournalSnapshot | null;
  /** "manual" (trader note, default) or "system" (auto open/close event). */
  kind?: 'manual' | 'system';
};

/**
 * Append-only timeline of manual notes for one Bitget trade session (a live
 * position), keyed by `tradeKey`. Each save is a new row — the ordered list of
 * notes is the record of how the trade was watched. See the `BitgetTradeJournal`
 * model in schema.prisma.
 */
export function createBitgetTradeJournalRepository(client = prisma) {
  return {
    /** All notes for one trade session, oldest first (chronological timeline). */
    findByTradeKey(tradeKey: string) {
      return client.bitgetTradeJournal.findMany({
        where: { tradeKey },
        orderBy: { createdAt: 'asc' },
      });
    },

    findById(id: string) {
      return client.bitgetTradeJournal.findUnique({ where: { id } });
    },

    create(input: BitgetTradeJournalInput) {
      return client.bitgetTradeJournal.create({
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
      return client.bitgetTradeJournal.update({
        where: { id },
        data: { content: input.content, images: input.images ?? [] },
      });
    },

    deleteById(id: string) {
      return client.bitgetTradeJournal.delete({ where: { id } });
    },
  };
}
