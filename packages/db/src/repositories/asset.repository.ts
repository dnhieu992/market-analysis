import { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type AssetCategoryInput = {
  key: string;
  label: string;
  sortOrder?: number;
};

/** One movement of USDT. `DEPOSIT` has no source, `WITHDRAW` no destination. */
export type AssetTransactionInput = {
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER';
  amountUsdt: number;
  fromCategoryId?: string | null;
  toCategoryId?: string | null;
  note?: string | null;
  occurredAt: Date;
};

/** Net USDT that ever landed in one bucket (in − out). */
export type AssetCategoryBalance = {
  categoryId: string;
  balanceUsdt: number;
};

/** The `spot | trading | bitget | mexc | wallet` buckets on /my-asset. */
export function createAssetCategoryRepository(client = prisma) {
  return {
    /** Display order of the page: sortOrder first, then label as a stable tiebreak. */
    findAll() {
      return client.assetCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      });
    },

    findById(id: string) {
      return client.assetCategory.findUnique({ where: { id } });
    },

    findByKey(key: string) {
      return client.assetCategory.findUnique({ where: { key } });
    },

    create({ key, label, sortOrder }: AssetCategoryInput) {
      return client.assetCategory.create({
        data: { key, label, sortOrder: sortOrder ?? 0 },
      });
    },

    /** Rename / reorder. The `key` is deliberately not updatable — it is the stable handle. */
    update(id: string, data: { label?: string; sortOrder?: number }) {
      return client.assetCategory.update({ where: { id }, data });
    },

    deleteById(id: string) {
      return client.assetCategory.delete({ where: { id } });
    },

    /** How many ledger rows still reference a bucket — a non-zero count blocks deletion. */
    countTransactions(id: string) {
      return client.assetTransaction.count({
        where: { OR: [{ fromCategoryId: id }, { toCategoryId: id }] },
      });
    },
  };
}

/** The append-only USDT ledger behind every number on /my-asset. */
export function createAssetTransactionRepository(client = prisma) {
  return {
    /** Newest movement first; `createdAt` breaks ties within the same day. */
    findAll(limit = 200) {
      return client.assetTransaction.findMany({
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      });
    },

    create(input: AssetTransactionInput) {
      return client.assetTransaction.create({
        data: {
          type: input.type,
          amountUsdt: new Prisma.Decimal(input.amountUsdt),
          fromCategoryId: input.fromCategoryId ?? null,
          toCategoryId: input.toCategoryId ?? null,
          note: input.note ?? null,
          occurredAt: input.occurredAt,
        },
      });
    },

    deleteById(id: string) {
      return client.assetTransaction.delete({ where: { id } });
    },

    /**
     * Lifetime USDT per movement type, summed in SQL for the same reason as
     * `sumBalances`. Types with no rows are absent.
     */
    async sumByType(): Promise<Record<string, number>> {
      const rows = await client.assetTransaction.groupBy({
        by: ['type'],
        _sum: { amountUsdt: true },
      });
      return Object.fromEntries(rows.map((r) => [r.type, Number(r._sum.amountUsdt ?? 0)]));
    },

    /**
     * Per-bucket balance, summed in the database rather than in JS so the page
     * stays correct once the ledger outgrows the row limit used by `findAll`.
     * Buckets with no movements are absent — the caller defaults them to 0.
     */
    async sumBalances(): Promise<AssetCategoryBalance[]> {
      const [incoming, outgoing] = await Promise.all([
        client.assetTransaction.groupBy({
          by: ['toCategoryId'],
          where: { toCategoryId: { not: null } },
          _sum: { amountUsdt: true },
        }),
        client.assetTransaction.groupBy({
          by: ['fromCategoryId'],
          where: { fromCategoryId: { not: null } },
          _sum: { amountUsdt: true },
        }),
      ]);

      const totals = new Map<string, number>();
      for (const row of incoming) {
        if (!row.toCategoryId) continue;
        totals.set(row.toCategoryId, Number(row._sum.amountUsdt ?? 0));
      }
      for (const row of outgoing) {
        if (!row.fromCategoryId) continue;
        const current = totals.get(row.fromCategoryId) ?? 0;
        totals.set(row.fromCategoryId, current - Number(row._sum.amountUsdt ?? 0));
      }

      return Array.from(totals, ([categoryId, balanceUsdt]) => ({ categoryId, balanceUsdt }));
    },
  };
}
