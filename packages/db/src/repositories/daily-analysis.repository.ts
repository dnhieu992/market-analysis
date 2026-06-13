import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createDailyAnalysisRepository(client = prisma) {
  return {
    create(data: Prisma.DailyAnalysisUncheckedCreateInput) {
      return client.dailyAnalysis.create({ data });
    },
    findByDate(symbol: string, date: Date) {
      return client.dailyAnalysis.findUnique({
        where: { symbol_date: { symbol, date } }
      });
    },
    listLatest(symbol: string, limit = 30) {
      return client.dailyAnalysis.findMany({
        where: { symbol },
        orderBy: { date: 'desc' },
        take: limit
      });
    },
    listAll(limit = 60) {
      return client.dailyAnalysis.findMany({
        orderBy: { date: 'desc' },
        take: limit
      });
    },
    findLatestBefore(symbol: string, date: Date) {
      return client.dailyAnalysis.findFirst({
        where: { symbol, date: { lt: date } },
        orderBy: { date: 'desc' }
      });
    },
    updateReviewNote(id: string, note: string) {
      // Updates only the note — leaves feedbackScore untouched.
      return client.dailyAnalysis.update({
        where: { id },
        data: { feedbackNote: note }
      });
    },
    updateFeedback(id: string, score?: number, note?: string) {
      return client.dailyAnalysis.update({
        where: { id },
        data: { feedbackScore: score ?? null, feedbackNote: note ?? null }
      });
    }
  };
}
