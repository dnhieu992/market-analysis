import { createServerApiClient } from '@web/shared/auth/api-auth';
import { OkxTabs, type OkxTab } from '@web/widgets/okx/okx-tabs';
import type { OkxHistoryResponse, OkxPositionsResponse } from '@web/shared/api/types';

const EMPTY_POSITIONS: OkxPositionsResponse = {
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

const EMPTY_HISTORY: OkxHistoryResponse = {
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
  positions: OkxPositionsResponse;
  history: OkxHistoryResponse;
}> {
  const client = createServerApiClient();
  const [positions, history] = await Promise.all([
    client.fetchOkxPositions().catch(() => EMPTY_POSITIONS),
    client.fetchOkxHistory({ limit: 200 }).catch(() => EMPTY_HISTORY),
  ]);
  return { positions, history };
}

type Props = {
  searchParams?: { tab?: string | string[] };
};

export default async function OkxPage({ searchParams }: Props) {
  const { positions, history } = await loadData();
  const tab = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;
  const initialTab: OkxTab =
    tab === 'history' ? 'history' : tab === 'setup' ? 'setup' : 'positions';
  return <OkxTabs positions={positions} history={history} initialTab={initialTab} />;
}
