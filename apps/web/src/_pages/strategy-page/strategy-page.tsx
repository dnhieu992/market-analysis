import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { TradingStrategy } from '@web/shared/api/types';
import { StrategiesList } from '@web/widgets/strategies-list/strategies-list';

async function loadStrategies() {
  const client = createServerApiClient();

  try {
    return await client.fetchTradingStrategies();
  } catch {
    return [] as TradingStrategy[];
  }
}

export default async function StrategyPage() {
  const strategies = await loadStrategies();

  return <StrategiesList strategies={strategies} />;
}
