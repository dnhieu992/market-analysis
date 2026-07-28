import { createServerApiClient } from '@web/shared/auth/api-auth';
import { MexcTabs, type MexcTab } from '@web/widgets/mexc/mexc-tabs';
import type { MexcHistoryResponse, MexcPositionsResponse } from '@web/shared/api/types';

const EMPTY_POSITIONS: MexcPositionsResponse = {
  configured: false,
  positions: [],
  totalUnrealizedPnlUsd: 0,
  totalMarginUsd: 0,
  accountEquityUsd: null,
  // No equity to compare against in the SSR fallback — the tile renders "—".
  initialCapitalUsd: 0,
  equityChangePct: null,
  fetchedAt: new Date().toISOString(),
};

const EMPTY_HISTORY: MexcHistoryResponse = {
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
  positions: MexcPositionsResponse;
  history: MexcHistoryResponse;
}> {
  const client = createServerApiClient();
  const [positions, history] = await Promise.all([
    client.fetchMexcPositions().catch(() => EMPTY_POSITIONS),
    client.fetchMexcHistory({ limit: 200 }).catch(() => EMPTY_HISTORY),
  ]);
  return { positions, history };
}

type Props = {
  searchParams?: { tab?: string | string[] };
};

export default async function MexcPage({ searchParams }: Props) {
  const { positions, history } = await loadData();
  const tab = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;
  const initialTab: MexcTab =
    tab === 'history' ? 'history' : tab === 'setup' ? 'setup' : 'positions';
  return <MexcTabs positions={positions} history={history} initialTab={initialTab} />;
}
