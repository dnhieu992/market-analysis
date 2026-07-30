import { prisma } from '../client';

/** Lifecycle of one auto-trade day. See the `BitgetAutoTradeRun` model. */
export type BitgetAutoTradeStatus = 'open' | 'extended' | 'closed' | 'skipped' | 'failed';

export type BitgetAutoTradeRunInput = {
  symbol: string;
  /** UTC date (YYYY-MM-DD) of the 00:00 entry — one run per coin per day. */
  tradeDate: string;
  status: BitgetAutoTradeStatus;
  entryPrice?: number | null;
  size?: number | null;
  leverage?: number | null;
  marginUsd?: number | null;
  tpPrice?: number | null;
  exitReason?: string | null;
  detail?: string | null;
  openedAt?: Date | null;
  resolvedAt?: Date | null;
};

/**
 * The per-coin "auto vào lệnh" switch for the /bitget Setup tab. One row per
 * symbol; a coin with no row is simply off. See `BitgetAutoTradeConfig` in
 * schema.prisma.
 */
export function createBitgetAutoTradeConfigRepository(client = prisma) {
  return {
    /** Every saved switch, for hydrating the Setup tab at once. */
    findAll() {
      return client.bitgetAutoTradeConfig.findMany({ orderBy: [{ symbol: 'asc' }] });
    },

    /** Only the coins the engine should trade — the cron's work list. */
    findEnabled() {
      return client.bitgetAutoTradeConfig.findMany({
        where: { enabled: true },
        orderBy: [{ symbol: 'asc' }],
      });
    },

    /** Turn auto-entry on/off for one coin. */
    upsert({ symbol, enabled }: { symbol: string; enabled: boolean }) {
      return client.bitgetAutoTradeConfig.upsert({
        where: { symbol },
        create: { symbol, enabled },
        update: { enabled },
      });
    },
  };
}

/**
 * Audit + idempotency log of the auto-entry engine: one row per (coin, UTC day).
 * The unique key is what stops a re-fired 00:00 cron from opening a second
 * position, so writes go through `create` (not upsert) on the entry path.
 * See `BitgetAutoTradeRun` in schema.prisma.
 */
export function createBitgetAutoTradeRunRepository(client = prisma) {
  return {
    /** The run for one coin on one UTC day, or null when the day is untouched. */
    findByDate(symbol: string, tradeDate: string) {
      return client.bitgetAutoTradeRun.findUnique({
        where: { symbol_tradeDate: { symbol, tradeDate } },
      });
    },

    /**
     * Insert the day's run. Throws on the unique constraint when a run already
     * exists — deliberately: that collision means "an entry was already taken
     * today" and must never be overwritten by a second one.
     */
    create(input: BitgetAutoTradeRunInput) {
      return client.bitgetAutoTradeRun.create({ data: input });
    },

    /** Every run still holding a live position — the 09:00 review's work list. */
    findLive() {
      return client.bitgetAutoTradeRun.findMany({
        where: { status: { in: ['open', 'extended'] } },
        orderBy: [{ tradeDate: 'asc' }, { symbol: 'asc' }],
      });
    },

    /** Update one run's state as the engine advances it. */
    update(id: string, patch: Partial<BitgetAutoTradeRunInput>) {
      return client.bitgetAutoTradeRun.update({ where: { id }, data: patch });
    },

    /**
     * Latest run per coin for the UI: the live one when there is any, else the
     * most recent day. Reads the newest rows and dedupes in memory — the table
     * holds at most one row per coin per day, so the window stays small.
     */
    async findLatestPerSymbol(limit = 200) {
      const rows = await client.bitgetAutoTradeRun.findMany({
        orderBy: [{ tradeDate: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      });
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (!latest.has(r.symbol)) latest.set(r.symbol, r);
      return [...latest.values()];
    },
  };
}
