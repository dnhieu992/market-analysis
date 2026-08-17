import { prisma } from '../client';

/** Fields known when a trade is first seen open (from `account/positions`). */
export type OkxTradeOpenInput = {
  tradeKey: string;
  symbol: string;
  holdSide: string;
  marginMode: string;
  openAvgPrice: number;
  openTotalPos: number;
  /** Effective leverage at open (notional ÷ margin); omit if unknown. */
  leverage?: number | null;
  openedAt: Date;
};

/** Realized-PnL fields known only once a trade closes (from `account/positions-history`). */
export type OkxTradeCloseInput = {
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
export type OkxTradeClosedInput = OkxTradeOpenInput & OkxTradeCloseInput;

/**
 * Lifecycle CRUD for `okx_trades` (one row per OKX trade, `status`
 * open→closed). The worker reconciles open positions and closed history into
 * this table; the /okx history tab reads the `closed` rows. See the
 * `OkxTrade` model in schema.prisma.
 */
export function createOkxTradeRepository(client = prisma) {
  return {
    findByTradeKey(tradeKey: string) {
      return client.okxTrade.findUnique({ where: { tradeKey } });
    },

    findByPositionId(positionId: string) {
      return client.okxTrade.findUnique({ where: { positionId } });
    },

    /** All still-open trades. */
    findOpen() {
      return client.okxTrade.findMany({ where: { status: 'open' } });
    },

    /** Still-open trades for a symbol+side, newest open first (at most one on OKX). */
    findOpenBySymbolSide(symbol: string, holdSide: string) {
      return client.okxTrade.findMany({
        where: { status: 'open', symbol, holdSide },
        orderBy: { openedAt: 'desc' },
      });
    },

    createOpen(input: OkxTradeOpenInput) {
      return client.okxTrade.create({ data: { ...input, status: 'open' } });
    },

    /**
     * Advance (or reset) the ROE% milestone ratchets on an open trade. Only the
     * fields passed are written, so the up/down ratchets update independently;
     * pass `null` to clear a ratchet when ROE reverses across 0.
     */
    updateMilestones(id: string, input: { peakRoePct?: number | null; troughRoePct?: number | null }) {
      return client.okxTrade.update({ where: { id }, data: input });
    },

    /** Flip an open trade to closed, filling the realized-PnL fields. */
    markClosed(id: string, input: OkxTradeCloseInput) {
      return client.okxTrade.update({
        where: { id },
        data: { ...input, status: 'closed' },
      });
    },

    /** Insert a trade that we never saw open (opened + closed between polls). */
    createClosed(input: OkxTradeClosedInput) {
      return client.okxTrade.create({ data: { ...input, status: 'closed' } });
    },

    /** Newest-closed first, capped. Optional symbol filter. */
    findRecentClosed(limit = 200, symbol?: string) {
      return client.okxTrade.findMany({
        where: { status: 'closed', ...(symbol ? { symbol } : {}) },
        orderBy: { closedAt: 'desc' },
        take: limit,
      });
    },

    /**
     * All-time realized PnL across every closed trade the sync has mirrored —
     * the `/my-asset` fallback when the exchange balance can't be read. See the
     * Bitget twin for the rolling-window caveat.
     */
    async sumRealizedPnl(): Promise<number> {
      const agg = await client.okxTrade.aggregate({
        where: { status: 'closed' },
        _sum: { netProfit: true },
      });
      return agg._sum.netProfit ?? 0;
    },

    /** Drop closed trades that closed before `date` — trims the log to the anchor. */
    async deleteClosedBefore(date: Date): Promise<number> {
      const res = await client.okxTrade.deleteMany({
        where: { status: 'closed', closedAt: { lt: date } },
      });
      return res.count;
    },

    /** Close time of the most-recent closed trade — the sync watermark. */
    async latestClosedAt(): Promise<Date | null> {
      const row = await client.okxTrade.findFirst({
        where: { status: 'closed' },
        orderBy: { closedAt: 'desc' },
        select: { closedAt: true },
      });
      return row?.closedAt ?? null;
    },
  };
}
