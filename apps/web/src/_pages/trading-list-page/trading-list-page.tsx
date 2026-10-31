import { createServerApiClient } from '@web/shared/auth/api-auth';
import { TradingListView } from '@web/widgets/trading-list/trading-list-view';
import type {
  BitgetHistoryResponse,
  BitgetPositionsResponse,
  MexcHistoryResponse,
  MexcPositionsResponse,
} from '@web/shared/api/types';

const EMPTY_POSITIONS: BitgetPositionsResponse & MexcPositionsResponse = {
  configured: false,
  positions: [],
  totalUnrealizedPnlUsd: 0,
  totalMarginUsd: 0,
  accountEquityUsd: null,
  initialCapitalUsd: 0,
  equityChangePct: null,
  fetchedAt: new Date().toISOString(),
};

const EMPTY_HISTORY: BitgetHistoryResponse & MexcHistoryResponse = {
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

/** /trading-list — both exchanges' snapshots, each non-fatal on its own. */
export default async function TradingListPage() {
  const client = createServerApiClient();
  const [bitgetPositions, bitgetHistory, mexcPositions, mexcHistory] = await Promise.all([
    client.fetchBitgetPositions().catch(() => EMPTY_POSITIONS),
    client.fetchBitgetHistory({ limit: 'all' }).catch(() => EMPTY_HISTORY),
    client.fetchMexcPositions().catch(() => EMPTY_POSITIONS),
    // The MEXC endpoint caps a page at 500 closed trades — plenty to list every traded coin.
    client.fetchMexcHistory({ limit: 500 }).catch(() => EMPTY_HISTORY),
  ]);
  return (
    <TradingListView
      bitgetPositions={bitgetPositions}
      bitgetHistory={bitgetHistory}
      mexcPositions={mexcPositions}
      mexcHistory={mexcHistory}
    />
  );
}
