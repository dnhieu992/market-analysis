import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DailyAnalysis, TrackedSetup } from '@web/shared/api/types';
import { DailyPlanFeed } from '@web/widgets/daily-plan-feed/daily-plan-feed';

async function loadDailyAnalysis(): Promise<DailyAnalysis[]> {
  const client = createServerApiClient();

  try {
    return await client.fetchDailyAnalysis();
  } catch {
    return [];
  }
}

async function loadTrackedSetups(planIds: string[]): Promise<TrackedSetup[]> {
  if (planIds.length === 0) return [];
  const client = createServerApiClient();

  try {
    return await client.fetchTrackedSetupsByPlans(planIds);
  } catch {
    return [];
  }
}

export default async function DailyPlanPage() {
  const records = await loadDailyAnalysis();
  const setups = await loadTrackedSetups(records.map((r) => r.id));

  // Group setups by the plan they belong to so each card can render its own.
  const setupsByPlan: Record<string, TrackedSetup[]> = {};
  for (const setup of setups) {
    (setupsByPlan[setup.dailyAnalysisId] ??= []).push(setup);
  }

  return <DailyPlanFeed records={records} setupsByPlan={setupsByPlan} />;
}
