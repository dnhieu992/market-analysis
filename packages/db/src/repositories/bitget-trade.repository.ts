import { prisma } from '../client';

/** Fields known when a trade is first seen open (from `all-position`). */
export type BitgetTradeOpenInput = {
  tradeKey: string;
  symbol: string;
  holdSide: string;
  marginMode: string;
  openAvgPrice: number;
  openTotalPos: number;
  openedAt: Date;
};

/** Realized-PnL fields known only once a trade closes (from `history-position`). */
export type BitgetTradeCloseInput = {
  positionId: string;
  closeAvgPrice: number;
  netProfit: number;
  pnl: number;
  totalFunding: number;
  openFee: number;
  closeFee: number;
  closedAt: Date;
};

/** A trade that was opened and closed between polls — full lifecycle at once. */
export type BitgetTradeClosedInput = BitgetTradeOpenInput & BitgetTradeCloseInput;

/**
 * Lifecycle CRUD for `bitget_trades` (one row per Bitget trade, `status`
 * open→closed). The worker reconciles open positions and closed history into
 * this table; the /bitget history tab reads the `closed` rows. See the
 * `BitgetTrade` model in schema.prisma.
 */
export function createBitgetTradeRepository(client = prisma) {
  return {
    findByTradeKey(tradeKey: string) {
      return client.bitgetTrade.findUnique({ where: { tradeKey } });
    },

    findByPositionId(positionId: string) {
      return client.bitgetTrade.findUnique({ where: { positionId } });
    },

    /** All still-open trades. */
    findOpen() {
      return client.bitgetTrade.findMany({ where: { status: 'open' } });
    },

    /** Still-open trades for a symbol+side, newest open first (at most one on Bitget). */
    findOpenBySymbolSide(symbol: string, holdSide: string) {
      return client.bitgetTrade.findMany({
        where: { status: 'open', symbol, holdSide },
        orderBy: { openedAt: 'desc' },
      });
    },

    createOpen(input: BitgetTradeOpenInput) {
      return client.bitgetTrade.create({ data: { ...input, status: 'open' } });
    },

    /**
     * Advance the ROE% milestone ratchets on an open trade. Only the fields
     * passed are written, so the up/down ratchets update independently.
     */
    updateMilestones(id: string, input: { peakRoePct?: number; troughRoePct?: number }) {
      return client.bitgetTrade.update({ where: { id }, data: input });
    },

    /** Flip an open trade to closed, filling the realized-PnL fields. */
    markClosed(id: string, input: BitgetTradeCloseInput) {
      return client.bitgetTrade.update({
        where: { id },
        data: { ...input, status: 'closed' },
      });
    },

    /** Insert a trade that we never saw open (opened + closed between polls). */
    createClosed(input: BitgetTradeClosedInput) {
      return client.bitgetTrade.create({ data: { ...input, status: 'closed' } });
    },

    /** Newest-closed first, capped. Optional symbol filter. */
    findRecentClosed(limit = 200, symbol?: string) {
      return client.bitgetTrade.findMany({
        where: { status: 'closed', ...(symbol ? { symbol } : {}) },
        orderBy: { closedAt: 'desc' },
        take: limit,
      });
    },

    /** Drop closed trades that closed before `date` — trims the log to the anchor. */
    async deleteClosedBefore(date: Date): Promise<number> {
      const res = await client.bitgetTrade.deleteMany({
        where: { status: 'closed', closedAt: { lt: date } },
      });
      return res.count;
    },

    /** Close time of the most-recent closed trade — the sync watermark. */
    async latestClosedAt(): Promise<Date | null> {
      const row = await client.bitgetTrade.findFirst({
        where: { status: 'closed' },
        orderBy: { closedAt: 'desc' },
        select: { closedAt: true },
      });
      return row?.closedAt ?? null;
    },
  };
}
