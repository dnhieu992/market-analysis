import { createServerApiClient } from '@web/shared/auth/api-auth';
import { TrackingCoinsFeed } from '@web/widgets/tracking-coins/tracking-coins-feed';
import type { TrackingCoinRow } from '@web/shared/api/types';

async function loadCoins(): Promise<TrackingCoinRow[]> {
  try {
    return await createServerApiClient().fetchTrackingCoins();
  } catch {
    return [];
  }
}

export default async function TrackingCoinsPage() {
  const coins = await loadCoins();
  return <TrackingCoinsFeed initialCoins={coins} />;
}
