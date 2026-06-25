import { createServerApiClient } from '@web/shared/auth/api-auth';
import { TopCapRadarFeed } from '@web/widgets/top-cap-radar/top-cap-radar-feed';
import type { TopCapCoinRow } from '@web/shared/api/types';

async function loadCoins(): Promise<TopCapCoinRow[]> {
  try {
    return await createServerApiClient().fetchTopCapRadar();
  } catch {
    return [];
  }
}

export default async function TopCapRadarPage() {
  const coins = await loadCoins();
  return <TopCapRadarFeed initialCoins={coins} />;
}
