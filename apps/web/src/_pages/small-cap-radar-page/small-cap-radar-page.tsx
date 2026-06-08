import { createServerApiClient } from '@web/shared/auth/api-auth';
import { SmallCapRadarFeed } from '@web/widgets/small-cap-radar/small-cap-radar-feed';
import type { SmallCapCoinRow } from '@web/shared/api/types';

async function loadCoins(): Promise<SmallCapCoinRow[]> {
  try {
    return await createServerApiClient().fetchSmallCapRadar();
  } catch {
    return [];
  }
}

export default async function SmallCapRadarPage() {
  const coins = await loadCoins();
  return <SmallCapRadarFeed initialCoins={coins} />;
}
