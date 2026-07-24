import { prisma } from '../client';

export type BitgetTradeChartInput = {
  tradeKey: string;
  symbol: string;
  timeframe: string;
  url: string;
  objectKey: string;
  /** Optional free-text note stored alongside the snapshot. */
  note?: string | null;
};

/**
 * Saved trade-chart snapshots. One row per (tradeKey, timeframe) — re-saving the
 * same trade+timeframe replaces the previous archive. See the `BitgetTradeChart`
 * model in schema.prisma.
 */
export function createBitgetTradeChartRepository(client = prisma) {
  return {
    /** All saved charts for one trade (any timeframe), newest first. */
    findByTradeKey(tradeKey: string) {
      return client.bitgetTradeChart.findMany({
        where: { tradeKey },
        orderBy: { createdAt: 'desc' },
      });
    },

    /** All saved charts for one coin (any trade / timeframe), newest first. */
    findBySymbol(symbol: string) {
      return client.bitgetTradeChart.findMany({
        where: { symbol },
        orderBy: { createdAt: 'desc' },
      });
    },

    /** Insert or replace the saved chart for one (tradeKey, timeframe). */
    upsert(input: BitgetTradeChartInput) {
      const { tradeKey, timeframe, symbol, url, objectKey, note = null } = input;
      return client.bitgetTradeChart.upsert({
        where: { tradeKey_timeframe: { tradeKey, timeframe } },
        create: { tradeKey, timeframe, symbol, url, objectKey, note },
        update: { symbol, url, objectKey, note },
      });
    },
  };
}
