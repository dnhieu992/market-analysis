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

type StrategyPageProps = {
  searchParams?: { id?: string };
};

export default async function StrategyPage({ searchParams }: StrategyPageProps) {
  const strategies = await loadStrategies();
  const selectedId = searchParams?.id ?? null;

  return <StrategiesList strategies={strategies} selectedId={selectedId} />;
}
