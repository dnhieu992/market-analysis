import type { StrategyPaperTradePath } from '@prisma/client';

import { prisma } from '../client';

export type StrategyPaperTradePathData = {
  entryPrice: number;
  risk: number;
  direction: string;
  closeR: number[];
  mfeR: number;
  maeR: number;
  mfeMin: number | null;
  maeMin: number | null;
  tp1Min: number | null;
  exitMin: number | null;
};

function toData(row: StrategyPaperTradePath): StrategyPaperTradePathData & { tradeId: string } {
  return {
    tradeId: row.tradeId,
    entryPrice: row.entryPrice,
    risk: row.risk,
    direction: row.direction,
    closeR: row.closeR as number[],
    mfeR: row.mfeR,
    maeR: row.maeR,
    mfeMin: row.mfeMin,
    maeMin: row.maeMin,
    tp1Min: row.tp1Min,
    exitMin: row.exitMin,
  };
}

export function createStrategyPaperTradePathRepository(client = prisma) {
  return {
    async find(tradeId: string): Promise<(StrategyPaperTradePathData & { tradeId: string }) | null> {
      const row = await client.strategyPaperTradePath.findUnique({ where: { tradeId } });
      return row ? toData(row) : null;
    },

    async findMany(tradeIds: string[]): Promise<Array<StrategyPaperTradePathData & { tradeId: string }>> {
      if (tradeIds.length === 0) return [];
      const rows = await client.strategyPaperTradePath.findMany({ where: { tradeId: { in: tradeIds } } });
      return rows.map(toData);
    },

    save(tradeId: string, data: StrategyPaperTradePathData) {
      const fields = { ...data, tradeId };
      return client.strategyPaperTradePath.upsert({ where: { tradeId }, create: fields, update: fields });
    },
  };
}
