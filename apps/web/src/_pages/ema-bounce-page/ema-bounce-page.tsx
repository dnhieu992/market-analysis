import { createServerApiClient } from '@web/shared/auth/api-auth';
import { EmaBounceFeed } from '@web/widgets/ema-bounce/ema-bounce-feed';
import type { EmaBounceCoin, EmaBounceSignal } from '@web/shared/api/types';

async function loadData(): Promise<{ coins: EmaBounceCoin[]; signals: EmaBounceSignal[] }> {
  const client = createServerApiClient();
  const [coins, signals] = await Promise.all([
    client.fetchEmaBounceCoins().catch(() => [] as EmaBounceCoin[]),
    client.fetchEmaBounceSignals().catch(() => [] as EmaBounceSignal[]),
  ]);
  return { coins, signals };
}

export default async function EmaBouncePage() {
  const { coins, signals } = await loadData();
  return <EmaBounceFeed initialCoins={coins} initialSignals={signals} />;
}
