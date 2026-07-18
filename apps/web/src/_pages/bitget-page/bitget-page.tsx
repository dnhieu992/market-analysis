import { createServerApiClient } from '@web/shared/auth/api-auth';
import { BitgetTabs, type BitgetTab } from '@web/widgets/bitget/bitget-tabs';
import type { BitgetHistoryResponse, BitgetPositionsResponse } from '@web/shared/api/types';

const EMPTY_POSITIONS: BitgetPositionsResponse = {
  configured: false,
  positions: [],
  totalUnrealizedPnlUsd: 0,
  totalMarginUsd: 0,
  accountEquityUsd: null,
  fetchedAt: new Date().toISOString(),
};

const EMPTY_HISTORY: BitgetHistoryResponse = {
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

async function loadData(): Promise<{
  positions: BitgetPositionsResponse;
  history: BitgetHistoryResponse;
}> {
  const client = createServerApiClient();
  const [positions, history] = await Promise.all([
    client.fetchBitgetPositions().catch(() => EMPTY_POSITIONS),
    client.fetchBitgetHistory({ limit: 200 }).catch(() => EMPTY_HISTORY),
  ]);
  return { positions, history };
}

type Props = {
  searchParams?: { tab?: string | string[] };
};

export default async function BitgetPage({ searchParams }: Props) {
  const { positions, history } = await loadData();
  const tab = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;
  const initialTab: BitgetTab = tab === 'history' ? 'history' : 'positions';
  return <BitgetTabs positions={positions} history={history} initialTab={initialTab} />;
}
