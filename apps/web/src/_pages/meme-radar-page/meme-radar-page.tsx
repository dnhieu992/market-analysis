import { createServerApiClient } from '@web/shared/auth/api-auth';
import { MemeRadarFeed } from '@web/widgets/meme-radar/meme-radar-feed';
import type { MemeCoinRow } from '@web/shared/api/types';

async function loadCoins(): Promise<MemeCoinRow[]> {
  try {
    return await createServerApiClient().fetchMemeRadar();
  } catch {
    return [];
  }
}

export default async function MemeRadarPage() {
  const coins = await loadCoins();
  return <MemeRadarFeed initialCoins={coins} />;
}
