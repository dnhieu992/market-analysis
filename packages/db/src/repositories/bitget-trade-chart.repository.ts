import { prisma } from '../client';

export type BitgetTradeChartInput = {
  tradeKey: string;
  symbol: string;
  timeframe: string;
  url: string;
  objectKey: string;
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

    /** Insert or replace the saved chart for one (tradeKey, timeframe). */
    upsert(input: BitgetTradeChartInput) {
      const { tradeKey, timeframe, symbol, url, objectKey } = input;
      return client.bitgetTradeChart.upsert({
        where: { tradeKey_timeframe: { tradeKey, timeframe } },
        create: { tradeKey, timeframe, symbol, url, objectKey },
        update: { symbol, url, objectKey },
      });
    },
  };
}
