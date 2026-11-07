import { scanJunkShorts } from '@app/core';
import { createJunkShortCoinRepository } from '@app/db';

import type { ChatTool } from '../contracts/chat-tool';

/**
 * Thin chat wrapper over `scanJunkShorts` (@app/core) — same scan the worker's Telegram alert runs.
 * Scans ONLY the user's coin list from /short-junk (table junk_short_coins); an empty list returns
 * an error telling the model to ask the user to add coins, never a fallback to the whole market.
 */
const coinRepo = createJunkShortCoinRepository();

type ScanInput = { minMarketCapUsd?: number; maxMarketCapUsd?: number; minBelowAthPct?: number; minListingDays?: number; topGainers?: number };

const CACHE_MS = 5 * 60_000;
let cache: { key: string; at: number; result: string } | null = null;

export const scanJunkShortsTool: ChatTool<ScanInput, string> = {
  name: 'scan_junk_shorts',
  description:
    'Scan the user\'s junk-coin list (managed on the /short-junk page — ONLY those coins are scanned, including topGainers) ' +
    'for SHORT setups. Coins failing the study\'s junk gates are still scanned and carry warnings[]. Study junk gates = listed on BOTH Binance spot (USDT) and USDT-M perpetuals, futures listed ' +
    '≥ minListingDays (default 90), and BEFORE the pump (3 days before the signal candle; the signal candle for setup B): ' +
    'market cap between minMarketCapUsd and maxMarketCapUsd (default $20M–$500M, circulating supply × price then) and price ' +
    '≥ minBelowAthPct below its all-time high (default 50%). ' +
    'Returns: btc D1 regime (close vs EMA50); candidates with setup A_PUMP_FADE (3D close-to-close ≥ +50% on the last closed D1), ' +
    'WATCH_PUMP (+30–50%), B_EMA_BOUNCE (D1 downtrend, red candle wicked into EMA20, closed under EMA50) — each with funding, ' +
    'Monitoring tag, listing age and a ladder plan; and topGainers = Binance USDT-M top 24h gainers (any coin) flagged junk / ' +
    'notJunkReason, with pump3dIfClosedNowPct (≥ 50 = becomes setup A at the next D1 close).',
  inputSchema: {
    type: 'object',
    properties: {
      minMarketCapUsd: { type: 'number', description: 'Cap floor before the pump, USD (default 20000000)' },
      maxMarketCapUsd: { type: 'number', description: 'Cap ceiling before the pump, USD (default 500000000)' },
      minBelowAthPct: { type: 'number', description: 'Minimum % below the all-time high before the pump (default 50)' },
      minListingDays: { type: 'number', description: 'Minimum days since the futures listing (default 90)' },
      topGainers: { type: 'number', description: 'How many Binance top 24h gainers to return (default 20, max 50)' }
    }
  },
  async execute(input) {
    let symbols: string[];
    try {
      symbols = await coinRepo.symbols();
    } catch (err) {
      return JSON.stringify({ error: `could not read the junk coin list: ${(err as Error).message}` });
    }
    if (symbols.length === 0) {
      return JSON.stringify({ error: 'The junk coin list is empty — ask the user to add coins on the /short-junk page (🗑️ Coin rác).' });
    }
    const key = JSON.stringify({ ...(input ?? {}), symbols });
    if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.result;
    try {
      const result = JSON.stringify(
        await scanJunkShorts({
          minMarketCapUsd: input?.minMarketCapUsd,
          maxMarketCapUsd: input?.maxMarketCapUsd,
          minBelowAth: input?.minBelowAthPct != null ? input.minBelowAthPct / 100 : undefined,
          minListingDays: input?.minListingDays,
          topGainers: input?.topGainers,
          fapiBaseUrl: process.env.BINANCE_FAPI_BASE_URL,
          symbols
        })
      );
      cache = { key, at: Date.now(), result };
      return result;
    } catch (err) {
      return JSON.stringify({ error: `scan_junk_shorts failed: ${(err as Error).message}` });
    }
  }
};
