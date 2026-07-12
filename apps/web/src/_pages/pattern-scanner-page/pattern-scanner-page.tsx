import { createServerApiClient } from '@web/shared/auth/api-auth';
import { PatternScannerFeed } from '@web/widgets/pattern-scanner/pattern-scanner-feed';
import type { PatternWatchCoin } from '@web/shared/api/types';

async function loadCoins(): Promise<PatternWatchCoin[]> {
  try {
    return await createServerApiClient().fetchPatternCoins();
  } catch {
    return [];
  }
}

export default async function PatternScannerPage() {
  const coins = await loadCoins();
  return <PatternScannerFeed initialCoins={coins} />;
}
