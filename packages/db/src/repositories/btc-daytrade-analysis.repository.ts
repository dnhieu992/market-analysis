import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

/**
 * Everything one day's BTC day-trading analysis stores, minus the bookkeeping
 * columns the repository manages itself (`id`, `runCount`, timestamps).
 */
export type BtcDaytradeAnalysisInput = Omit<
  Prisma.BtcDaytradeAnalysisUncheckedCreateInput,
  'id' | 'runCount' | 'createdAt' | 'updatedAt'
>;

/** Columns the history list needs — deliberately without the heavy JSON blobs. */
const LIST_SELECT = {
  date: true,
  direction: true,
  confidence: true,
  riskReward: true,
  summary: true,
  chartUrl: true,
  runCount: true,
  generatedAt: true,
} satisfies Prisma.BtcDaytradeAnalysisSelect;

export type BtcDaytradeAnalysisListItem = Prisma.BtcDaytradeAnalysisGetPayload<{
  select: typeof LIST_SELECT;
}>;

export function createBtcDaytradeAnalysisRepository(client = prisma) {
  return {
    /**
     * One row per day: re-running the agent overwrites the day's analysis and
     * bumps `runCount`. `date` must already be the UTC-midnight DATE for the
     * Vietnam calendar day — the caller owns that conversion, so the repository
     * never has to guess a timezone.
     */
    upsertByDate(input: BtcDaytradeAnalysisInput) {
      const { date, ...rest } = input;
      return client.btcDaytradeAnalysis.upsert({
        where: { date },
        create: { date, ...rest },
        update: { ...rest, runCount: { increment: 1 } },
      });
    },

    findByDate(date: Date) {
      return client.btcDaytradeAnalysis.findUnique({ where: { date } });
    },

    listRecent(limit = 30): Promise<BtcDaytradeAnalysisListItem[]> {
      return client.btcDaytradeAnalysis.findMany({
        select: LIST_SELECT,
        orderBy: { date: 'desc' },
        take: limit,
      });
    },
  };
}
