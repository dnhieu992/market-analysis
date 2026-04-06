import { createApiClient } from '@web/shared/api/client';
import type { DailyAnalysis } from '@web/shared/api/types';
import { DailyPlanFeed } from '@web/widgets/daily-plan-feed/daily-plan-feed';

async function loadDailyAnalysis(): Promise<DailyAnalysis[]> {
  const client = createApiClient();

  try {
    return await client.fetchDailyAnalysis('BTCUSDT');
  } catch {
    return [];
  }
}

export default async function DailyPlanPage() {
  const records = await loadDailyAnalysis();
  return <DailyPlanFeed records={records} />;
}
