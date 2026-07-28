import { prisma } from '../client';

export type MexcSetupConfigInput = {
  symbol: string;
  holdSide: string;
  leverage: number;
  marginUsd: number;
};

/**
 * Per-coin, per-side manual-open config for the /mexc Setup tab. One row per
 * (symbol, holdSide) — the leverage/margin the trader picked, persisted so the
 * two rows a coin shows (long + short) don't reset on reload. See the
 * `MexcSetupConfig` model in schema.prisma.
 */
export function createMexcSetupConfigRepository(client = prisma) {
  return {
    /** Every saved config, for hydrating the whole Setup tab at once. */
    findAll() {
      return client.mexcSetupConfig.findMany({
        orderBy: [{ symbol: 'asc' }, { holdSide: 'asc' }],
      });
    },

    /** Insert or update the config for one (symbol, holdSide). */
    upsert(input: MexcSetupConfigInput) {
      const { symbol, holdSide, leverage, marginUsd } = input;
      return client.mexcSetupConfig.upsert({
        where: { symbol_holdSide: { symbol, holdSide } },
        create: { symbol, holdSide, leverage, marginUsd },
        update: { leverage, marginUsd },
      });
    },

    /**
     * Apply the same config to many (symbol, holdSide) pairs in ONE transaction —
     * the bulk Setup dialog overwrites a whole batch, so a partial write would
     * leave the tab in a state the trader never asked for.
     */
    upsertMany(inputs: MexcSetupConfigInput[]) {
      return client.$transaction(
        inputs.map(({ symbol, holdSide, leverage, marginUsd }) =>
          client.mexcSetupConfig.upsert({
            where: { symbol_holdSide: { symbol, holdSide } },
            create: { symbol, holdSide, leverage, marginUsd },
            update: { leverage, marginUsd },
          }),
        ),
      );
    },
  };
}
