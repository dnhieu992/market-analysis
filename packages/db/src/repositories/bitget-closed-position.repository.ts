import { prisma } from '../client';

/** DB-ready closed position. Structurally matches `@app/core`'s
 *  `BitgetClosedNormalized`; declared locally so `@app/db` need not depend on
 *  `@app/core`. */
export type BitgetClosedPositionInput = {
  positionId: string;
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  openAvgPrice: number;
  closeAvgPrice: number;
  openTotalPos: number;
  netProfit: number;
  pnl: number;
  totalFunding: number;
  openFee: number;
  closeFee: number;
  openedAt: Date;
  closedAt: Date;
};

export function createBitgetClosedPositionRepository(client = prisma) {
  return {
    /**
     * Upsert a batch of synced closed positions, keyed by Bitget `positionId`.
     * Idempotent — re-syncing the same 90-day window just refreshes the rows,
     * so we never get duplicates. Runs the upserts in one transaction.
     */
    upsertMany(rows: BitgetClosedPositionInput[]) {
      if (rows.length === 0) return Promise.resolve(0);
      return client
        .$transaction(
          rows.map((r) =>
            client.bitgetClosedPosition.upsert({
              where: { positionId: r.positionId },
              create: r,
              update: {
                closeAvgPrice: r.closeAvgPrice,
                netProfit: r.netProfit,
                pnl: r.pnl,
                totalFunding: r.totalFunding,
                openFee: r.openFee,
                closeFee: r.closeFee,
                closedAt: r.closedAt,
              },
            }),
          ),
        )
        .then((res) => res.length);
    },

    /** Newest-closed first, capped. Optional symbol filter. */
    findRecent(limit = 200, symbol?: string) {
      return client.bitgetClosedPosition.findMany({
        where: symbol ? { symbol } : undefined,
        orderBy: { closedAt: 'desc' },
        take: limit,
      });
    },

    /** Close time of the most-recent stored trade — the sync watermark. */
    async latestClosedAt(): Promise<Date | null> {
      const row = await client.bitgetClosedPosition.findFirst({
        orderBy: { closedAt: 'desc' },
        select: { closedAt: true },
      });
      return row?.closedAt ?? null;
    },
  };
}
