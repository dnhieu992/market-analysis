import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type StrategyPaperNoteInput = {
  /** Free-text log entry (required). */
  body: string;
  /** Cloudflare R2 image URLs attached to this note (optional). */
  images?: string[];
};

/**
 * Free-form trading log for the PDH/PDL strategy board. One row per saved note,
 * shown newest-first in the "Ghi chú" dialog. See the `StrategyPaperNote` model
 * in schema.prisma.
 */
export function createStrategyPaperNoteRepository(client = prisma) {
  return {
    /** Newest first — the dialog reads the whole log, it stays small. */
    list(limit = 200) {
      return client.strategyPaperNote.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    create({ body, images = [] }: StrategyPaperNoteInput) {
      return client.strategyPaperNote.create({
        data: { body, images: images as Prisma.InputJsonValue },
      });
    },

    async remove(id: string): Promise<number> {
      const { count } = await client.strategyPaperNote.deleteMany({ where: { id } });
      return count;
    },
  };
}
