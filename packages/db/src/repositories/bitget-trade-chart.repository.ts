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

    /**
     * How many charts are archived per coin — one grouped query instead of one
     * `findBySymbol` per row, so the Setup tab's Attachments column can show a
     * count for every listed coin at once.
     */
    countBySymbol() {
      return client.bitgetTradeChart.groupBy({
        by: ['symbol'],
        _count: { _all: true },
      });
    },

    /**
     * How many charts are archived per trade — the History tab's Attachments
     * column, whose gallery is scoped to one `tradeKey` rather than a coin.
     */
    countByTradeKey() {
      return client.bitgetTradeChart.groupBy({
        by: ['tradeKey'],
        _count: { _all: true },
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
