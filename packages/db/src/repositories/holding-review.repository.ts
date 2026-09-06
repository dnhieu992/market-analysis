import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

/**
 * Verdicts written by the daily Claude portfolio review (00:00 UTC), one row per
 * coin per report date. Deliberately separate from `Holding.note`, which is the
 * trader's own field and must never be overwritten by the cron.
 */
export function createHoldingReviewRepository(client = prisma) {
  return {
    /** A re-run on the same day replaces that day's row rather than adding one. */
    upsert(
      portfolioId: string,
      coinId: string,
      reviewDate: Date,
      data: Omit<Prisma.HoldingReviewUncheckedCreateInput, 'portfolioId' | 'coinId' | 'reviewDate'>
    ) {
      return client.holdingReview.upsert({
        where: { portfolioId_coinId_reviewDate: { portfolioId, coinId, reviewDate } },
        create: { portfolioId, coinId, reviewDate, ...data },
        update: data
      });
    },

    /**
     * The newest review per coin for one portfolio — what the Holdings table
     * badges show. One query, deduped in memory: MySQL has no DISTINCT ON, and a
     * portfolio holds tens of coins with a few hundred rows of history at most.
     */
    async latestByCoin(portfolioId: string) {
      const rows = await client.holdingReview.findMany({
        where: { portfolioId },
        orderBy: [{ reviewDate: 'desc' }, { createdAt: 'desc' }]
      });

      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        if (!latest.has(row.coinId)) latest.set(row.coinId, row);
      }
      return [...latest.values()];
    },

    /** Full history for one coin, newest first — the coin detail page timeline. */
    listByCoin(portfolioId: string, coinId: string, limit = 60) {
      return client.holdingReview.findMany({
        where: { portfolioId, coinId },
        orderBy: [{ reviewDate: 'desc' }],
        take: limit
      });
    }
  };
}
