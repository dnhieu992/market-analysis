import { createServerApiClient } from '@web/shared/auth/api-auth';
import { BitgetPositionsFeed } from '@web/widgets/bitget-positions/bitget-positions-feed';
import type { BitgetPositionsResponse } from '@web/shared/api/types';

const EMPTY: BitgetPositionsResponse = {
  configured: false,
  positions: [],
  totalUnrealizedPnlUsd: 0,
  totalMarginUsd: 0,
  fetchedAt: new Date().toISOString(),
};

async function loadData(): Promise<BitgetPositionsResponse> {
  try {
    return await createServerApiClient().fetchBitgetPositions();
  } catch {
    return EMPTY;
  }
}

export default async function BitgetPositionsPage() {
  const initial = await loadData();
  return <BitgetPositionsFeed initial={initial} />;
}
