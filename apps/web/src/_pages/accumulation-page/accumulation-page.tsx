import { createServerApiClient } from '@web/shared/auth/api-auth';
import { AccumulationFeed } from '@web/widgets/accumulation/accumulation-feed';
import type { TrackingCoinRow } from '@web/shared/api/types';

async function loadCoins(): Promise<TrackingCoinRow[]> {
  try {
    return await createServerApiClient().fetchTrackingCoins();
  } catch {
    return [];
  }
}

export default async function AccumulationPage() {
  const coins = await loadCoins();
  return <AccumulationFeed initialCoins={coins} />;
}
