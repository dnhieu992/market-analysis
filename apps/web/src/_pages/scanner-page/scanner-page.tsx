import { createServerApiClient } from '@web/shared/auth/api-auth';
import { ScannerFeed } from '@web/widgets/scanner-feed/scanner-feed';

async function loadWatchlist(): Promise<string[]> {
  try {
    return await createServerApiClient().fetchScannerWatchlist();
  } catch {
    return [];
  }
}

export default async function ScannerPage() {
  const watchlist = await loadWatchlist();
  return <ScannerFeed initialWatchlist={watchlist} />;
}
