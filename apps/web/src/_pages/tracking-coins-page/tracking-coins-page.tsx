import { createServerApiClient } from '@web/shared/auth/api-auth';
import { TrackingCoinsFeed } from '@web/widgets/tracking-coins/tracking-coins-feed';
import type { TrackingCoinRow, TrackingTicker } from '@web/shared/api/types';

async function loadCoins(): Promise<TrackingCoinRow[]> {
  try {
    return await createServerApiClient().fetchTrackingCoins();
  } catch {
    return [];
  }
}

/** First paint ships with prices (same 5s server cache the client polls). */
async function loadTickers(symbols: string[]): Promise<TrackingTicker[]> {
  try {
    return await createServerApiClient().fetchTrackingTickers(symbols);
  } catch {
    return [];
  }
}

export default async function TrackingCoinsPage() {
  const coins = await loadCoins();
  const tickers = await loadTickers(coins.map((c) => c.symbol));
  return <TrackingCoinsFeed initialCoins={coins} initialTickers={tickers} />;
}
