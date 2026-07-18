import { createServerApiClient } from '@web/shared/auth/api-auth';
import { BitgetHistoryFeed } from '@web/widgets/bitget-history/bitget-history-feed';
import type { BitgetHistoryResponse } from '@web/shared/api/types';

const EMPTY: BitgetHistoryResponse = {
  configured: false,
  trades: [],
  summary: {
    trades: 0,
    wins: 0,
    losses: 0,
    winRatePct: 0,
    totalNetProfit: 0,
    avgNetProfit: 0,
    bestNetProfit: 0,
    worstNetProfit: 0,
    totalVolumeUsd: 0,
  },
  fetchedAt: new Date().toISOString(),
};

async function loadData(): Promise<BitgetHistoryResponse> {
  try {
    return await createServerApiClient().fetchBitgetHistory({ limit: 200 });
  } catch {
    return EMPTY;
  }
}

export default async function BitgetHistoryPage() {
  const initial = await loadData();
  return <BitgetHistoryFeed initial={initial} />;
}
