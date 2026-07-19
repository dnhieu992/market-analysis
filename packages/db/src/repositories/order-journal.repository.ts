import { prisma } from '../client';

export type OrderJournalSnapshot = {
  price?: number;
  entryPrice?: number;
  pnlUsd?: number;
};

export type OrderJournalInput = {
  orderId: string;
  content: string;
  images?: string[];
  snapshot?: OrderJournalSnapshot | null;
  /** "manual" (trader note, default) or "system" (auto open/close event). */
  kind?: 'manual' | 'system';
};

/**
 * Append-only timeline of notes for one manual /trades Order, keyed by
 * `orderId`. Each save is a new row — the ordered list of notes is the record
 * of how the trade was watched. `system` rows are the auto "opened"/"closed"
 * lifecycle events. See the `OrderJournal` model in schema.prisma.
 */
export function createOrderJournalRepository(client = prisma) {
  return {
    /** All notes for one order, oldest first (chronological timeline). */
    findByOrderId(orderId: string) {
      return client.orderJournal.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
    },

    findById(id: string) {
      return client.orderJournal.findUnique({ where: { id } });
    },

    create(input: OrderJournalInput) {
      return client.orderJournal.create({
        data: {
          orderId: input.orderId,
          kind: input.kind ?? 'manual',
          content: input.content,
          images: input.images ?? [],
          snapshot: input.snapshot ?? undefined,
        },
      });
    },

    update(id: string, input: { content: string; images?: string[] }) {
      return client.orderJournal.update({
        where: { id },
        data: { content: input.content, images: input.images ?? [] },
      });
    },

    deleteById(id: string) {
      return client.orderJournal.delete({ where: { id } });
    },
  };
}
