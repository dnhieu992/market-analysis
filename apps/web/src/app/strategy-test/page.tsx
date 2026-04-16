import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { BackTestResultRecord, BackTestStrategy } from '@web/shared/api/types';
import { BackTestFeed } from '@web/widgets/back-test-feed/back-test-feed';

async function loadData(): Promise<{
  strategies: BackTestStrategy[];
  initialResults: BackTestResultRecord[];
}> {
  const client = createServerApiClient();

  try {
    const [strategies, initialResults] = await Promise.all([
      client.fetchBackTestStrategies(),
      client.fetchBackTestResults()
    ]);
    return { strategies, initialResults };
  } catch {
    return { strategies: [], initialResults: [] };
  }
}

export default async function StrategyPage() {
  const { strategies, initialResults } = await loadData();

  return <BackTestFeed strategies={strategies} initialResults={initialResults} />;
}
