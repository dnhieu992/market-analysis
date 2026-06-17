import { createServerApiClient } from '@web/shared/auth/api-auth';
import { TrackedSetupsFeed } from '@web/widgets/tracked-setups/tracked-setups-feed';
import type { TrackedSetup } from '@web/shared/api/types';

async function loadSetups(): Promise<TrackedSetup[]> {
  try {
    return await createServerApiClient().fetchTrackedSetups();
  } catch {
    return [];
  }
}

export default async function TrackedSetupsPage() {
  const setups = await loadSetups();
  return <TrackedSetupsFeed setups={setups} />;
}
