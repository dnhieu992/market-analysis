import { scanJunkShorts } from '@app/core';

import type { ChatTool } from '../contracts/chat-tool';

/** Thin chat wrapper over `scanJunkShorts` (@app/core) — same scan the worker's Telegram alert runs. */

type ScanInput = { maxMarketCapUsd?: number; minListingDays?: number; topGainers?: number };

const CACHE_MS = 5 * 60_000;
let cache: { key: string; at: number; result: string } | null = null;

export const scanJunkShortsTool: ChatTool<ScanInput, string> = {
  name: 'scan_junk_shorts',
  description:
    'Scan Binance for junk-coin SHORT setups. Universe = coins listed on BOTH Binance spot (USDT) and USDT-M perpetuals, ' +
    'market cap ≤ maxMarketCapUsd (default $100M, circulating supply × price), futures listed ≥ minListingDays (default 90). ' +
    'Returns: btc D1 regime (close vs EMA50); candidates with setup A_PUMP_FADE (3D close-to-close ≥ +50% on the last closed D1), ' +
    'WATCH_PUMP (+30–50%), B_EMA_BOUNCE (D1 downtrend, red candle wicked into EMA20, closed under EMA50) — each with funding, ' +
    'Monitoring tag, listing age and a ladder plan; and topGainers = Binance USDT-M top 24h gainers (any coin) flagged junk / ' +
    'notJunkReason, with pump3dIfClosedNowPct (≥ 50 = becomes setup A at the next D1 close).',
  inputSchema: {
    type: 'object',
    properties: {
      maxMarketCapUsd: { type: 'number', description: 'Market-cap ceiling in USD (default 100000000)' },
      minListingDays: { type: 'number', description: 'Minimum days since the futures listing (default 90)' },
      topGainers: { type: 'number', description: 'How many Binance top 24h gainers to return (default 20, max 50)' }
    }
  },
  async execute(input) {
    const key = JSON.stringify(input ?? {});
    if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.result;
    try {
      const result = JSON.stringify(
        await scanJunkShorts({
          maxMarketCapUsd: input?.maxMarketCapUsd,
          minListingDays: input?.minListingDays,
          topGainers: input?.topGainers,
          fapiBaseUrl: process.env.BINANCE_FAPI_BASE_URL
        })
      );
      cache = { key, at: Date.now(), result };
      return result;
    } catch (err) {
      return JSON.stringify({ error: `scan_junk_shorts failed: ${(err as Error).message}` });
    }
  }
};
