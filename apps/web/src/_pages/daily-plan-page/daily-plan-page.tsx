import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DailyAnalysis } from '@web/shared/api/types';
import { DailyPlanFeed } from '@web/widgets/daily-plan-feed/daily-plan-feed';

async function loadDailyAnalysis(): Promise<DailyAnalysis[]> {
  const client = createServerApiClient();

  try {
    return await client.fetchDailyAnalysis();
  } catch {
    return [];
  }
}

export default async function DailyPlanPage() {
  const records = await loadDailyAnalysis();
  return <DailyPlanFeed records={records} />;
}
