import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type ShortScoreSnapshotInput = {
  symbol: string;
  takenAt: Date;
  scorePct: number;
  hitPoints: number;
  maxPoints: number;
  criteriaVersion: number;
  price?: number | null;
  results: Prisma.InputJsonValue;
  trigger: 'CRON' | 'CHAT' | 'UI';
};

/** Scores of the /trades OKX short chat's criteria set (see apps/api short-score module). */
export function createShortScoreSnapshotRepository(client = prisma) {
  return {
    create(input: ShortScoreSnapshotInput) {
      return client.shortScoreSnapshot.create({ data: { ...input, price: input.price ?? null } });
    },

    latest(symbol: string) {
      return client.shortScoreSnapshot.findFirst({ where: { symbol }, orderBy: { takenAt: 'desc' } });
    },

    list(symbol: string, take = 30) {
      return client.shortScoreSnapshot.findMany({ where: { symbol }, orderBy: { takenAt: 'desc' }, take: Math.min(Math.max(take, 1), 200) });
    },
  };
}
