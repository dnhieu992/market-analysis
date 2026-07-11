import { prisma } from '../client';

/** The metric payload for one daily spot-flip snapshot (everything but the
 *  identity keys symbol + date, which the caller passes separately). */
export type SpotFlipDailyInput = {
  price: number;
  upPct: number;
  downPct: number;
  pullbackPct: number;
  reboundPct: number;
  atrPct: number;
  high30d: number;
  low30d: number;
  changeH24?: number | null;
  notes?: string | null;
};

export function createSpotFlipDailyRepository(client = prisma) {
  return {
    // One row per coin per UTC day — re-running the job the same day overwrites.
    upsert(symbol: string, date: Date, data: SpotFlipDailyInput) {
      return client.spotFlipDaily.upsert({
        where: { symbol_date: { symbol, date } },
        create: { symbol, date, ...data },
        update: { ...data },
      });
    },

    // Newest first, capped — the page shows a rolling history per coin.
    findBySymbol(symbol: string, limit = 90) {
      return client.spotFlipDaily.findMany({
        where: { symbol },
        orderBy: { date: 'desc' },
        take: limit,
      });
    },
  };
}
