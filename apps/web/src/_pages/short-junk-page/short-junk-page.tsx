import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { JunkShortCoin } from '@web/shared/api/types';
import { ShortJunkView } from '@web/widgets/short-junk/short-junk-view';

/** /short-junk — the hand-kept junk coin list (CRUD) + the "Short Coin Rác" AI chat panel. */
export default async function ShortJunkPage() {
  const coins = await createServerApiClient()
    .fetchJunkCoins()
    .catch((): JunkShortCoin[] => []);
  return <ShortJunkView initialCoins={coins} />;
}
