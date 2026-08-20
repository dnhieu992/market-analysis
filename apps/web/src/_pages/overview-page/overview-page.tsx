import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { AssetSummary, DashboardOrder } from '@web/shared/api/types';
import { EXCHANGE_HISTORY_LIMIT } from '@web/shared/api/exchange-orders';
import { DashboardOverview } from '@web/widgets/dashboard-overview/dashboard-overview';

// The BTC/ETH Accumulated cards track the long-term DCA plan only — the
// "BTC&ETH(70%)" portfolio. Coins held in the short-term trading portfolios must
// not inflate the accumulation progress. Override with NEXT_PUBLIC_ACCUMULATION_PORTFOLIO_ID.
const ACCUMULATION_PORTFOLIO_ID =
  process.env.NEXT_PUBLIC_ACCUMULATION_PORTFOLIO_ID ?? '1cf1569e-2f47-4125-b004-cd27f9521a3a';

async function loadDashboardData() {
  const client = createServerApiClient();
  try {
    const [paginatedOrders, analysisRuns, portfolios, bitgetPnl, mexcPnl, okxPnl, assetSummary] = await Promise.all([
      client.fetchOrders({ pageSize: 20 }),
      client.fetchAnalysisRuns(),
      client.fetchPortfolios(),
      // Bitget/MEXC/OKX trades are not `Order` rows — fold their realized PnL in by hand.
      client
        .fetchBitgetHistory({ limit: EXCHANGE_HISTORY_LIMIT })
        .then((h) => h.summary.totalNetProfit)
        .catch(() => 0),
      client
        .fetchMexcHistory({ limit: EXCHANGE_HISTORY_LIMIT })
        .then((h) => h.summary.totalNetProfit)
        .catch(() => 0),
      client
        .fetchOkxHistory({ limit: EXCHANGE_HISTORY_LIMIT })
        .then((h) => h.summary.totalNetProfit)
        .catch(() => 0),
      // The whole-book summary. Its own catch, so an asset-service failure drops
      // the card rather than emptying the rest of the dashboard.
      client.fetchAssetSummary().catch(() => null as AssetSummary | null),
    ]);

    // fetch holdings for all portfolios in parallel
    const holdingsByPortfolio = await Promise.all(
      portfolios.map((p) => client.fetchHoldings(p.id).catch(() => []))
    );

    // aggregate by coinId across all portfolios; keep first portfolioId per coin for navigation
    const map = new Map<string, { totalAmount: number; totalCost: number; realizedPnl: number; portfolioId: string }>();
    portfolios.forEach((portfolio, i) => {
      const holdings = holdingsByPortfolio[i] ?? [];
      for (const h of holdings) {
        const existing = map.get(h.coinId);
        if (existing) {
          existing.totalAmount += h.totalAmount;
          existing.totalCost += h.totalInvested;
          existing.realizedPnl += h.realizedPnl;
        } else {
          map.set(h.coinId, { totalAmount: h.totalAmount, totalCost: h.totalInvested, realizedPnl: h.realizedPnl, portfolioId: portfolio.id });
        }
      }
    });

    const allHoldings = Array.from(map.entries()).map(([coinId, v]) => ({
      coinId,
      totalAmount: v.totalAmount,
      totalCost: v.totalCost,
      avgCost: v.totalAmount > 0 ? v.totalCost / v.totalAmount : 0,
      realizedPnl: v.realizedPnl,
      portfolioId: v.portfolioId,
    }));

    // Accumulation cards read a single portfolio, so no cross-portfolio merge here.
    const accumulationIndex = portfolios.findIndex((p) => p.id === ACCUMULATION_PORTFOLIO_ID);
    const accumulationHoldings = (accumulationIndex >= 0 ? holdingsByPortfolio[accumulationIndex] ?? [] : []).map((h) => ({
      coinId: h.coinId,
      totalAmount: h.totalAmount,
      totalCost: h.totalInvested,
      avgCost: h.totalAmount > 0 ? h.totalInvested / h.totalAmount : 0,
      portfolioId: ACCUMULATION_PORTFOLIO_ID,
    }));

    return {
      accumulationHoldings,
      recentOrders: paginatedOrders.data,
      openOrderCount: paginatedOrders.openOrders.length,
      closedOrderCount: paginatedOrders.total - paginatedOrders.openOrders.length,
      closedPnlSum: paginatedOrders.closedPnlSum + bitgetPnl + mexcPnl + okxPnl,
      analysisRuns,
      allHoldings,
      portfolioCount: portfolios.length,
      assetSummary,
    };
  } catch {
    return {
      recentOrders: [] as DashboardOrder[],
      openOrderCount: 0,
      closedOrderCount: 0,
      closedPnlSum: 0,
      analysisRuns: [],
      allHoldings: [],
      accumulationHoldings: [] as {
        coinId: string;
        totalAmount: number;
        totalCost: number;
        avgCost: number;
        portfolioId: string;
      }[],
      portfolioCount: 0,
      assetSummary: null as AssetSummary | null,
    };
  }
}

const BTC_TARGET = 1;
const ETH_TARGET = 10;

function buildOverviewCards(
  closedPnlSum: number,
  btcAmount: number,
  btcCost: number,
  btcAvgCost: number,
  ethAmount: number,
  ethCost: number,
  ethAvgCost: number,
  btcHref?: string,
  ethHref?: string,
) {
  const totalPnlStr =
    (closedPnlSum >= 0 ? '+' : '') +
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(closedPnlSum);

  const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  const btcStr = btcAmount > 0
    ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(btcAmount) + ' BTC'
    : '--';
  const btcProgress = Math.min((btcAmount / BTC_TARGET) * 100, 100);
  const btcPct = btcProgress.toFixed(2);
  const btcRemaining = Math.max(BTC_TARGET - btcAmount, 0);
  const btcRemainingStr = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(btcRemaining);
  const btcCostStr = btcCost > 0 ? usdFormatter.format(btcCost) : null;

  const ethStr = ethAmount > 0
    ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(ethAmount) + ' ETH'
    : '--';
  const ethProgress = Math.min((ethAmount / ETH_TARGET) * 100, 100);
  const ethPct = ethProgress.toFixed(2);
  const ethRemaining = Math.max(ETH_TARGET - ethAmount, 0);
  const ethRemainingStr = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(ethRemaining);
  const ethCostStr = ethCost > 0 ? usdFormatter.format(ethCost) : null;

  return [
    {
      label: 'BTC Accumulated',
      value: btcStr,
      detail: btcCostStr ? `${btcPct}% toward ${BTC_TARGET} BTC · ${btcCostStr} invested` : `${btcPct}% toward ${BTC_TARGET} BTC goal`,
      progress: btcProgress,
      progressLabel: btcRemaining > 0 ? `${btcRemainingStr} BTC remaining` : 'Goal reached!',
      livePrice: btcAmount > 0 && btcAvgCost > 0 ? { coinId: 'BTC', avgCost: btcAvgCost } : undefined,
      href: btcHref,
    },
    {
      label: 'ETH Accumulated',
      value: ethStr,
      detail: ethCostStr ? `${ethPct}% toward ${ETH_TARGET} ETH · ${ethCostStr} invested` : `${ethPct}% toward ${ETH_TARGET} ETH goal`,
      progress: ethProgress,
      progressLabel: ethRemaining > 0 ? `${ethRemainingStr} ETH remaining` : 'Goal reached!',
      livePrice: ethAmount > 0 && ethAvgCost > 0 ? { coinId: 'ETH', avgCost: ethAvgCost } : undefined,
      href: ethHref,
    },
    {
      label: 'Total Profit / Loss',
      value: closedPnlSum === 0 ? '--' : totalPnlStr,
      detail: 'All-time realized P/L across closed trades.',
      positive: closedPnlSum === 0 ? undefined : closedPnlSum >= 0,
      href: '/pnl-calendar?tab=trading'
    }
  ];
}

export default async function OverviewPage() {
  const { recentOrders, closedPnlSum, allHoldings, accumulationHoldings, portfolioCount, assetSummary } =
    await loadDashboardData();

  const btcHolding = accumulationHoldings.find((h) => h.coinId.toUpperCase() === 'BTC');
  const ethHolding = accumulationHoldings.find((h) => h.coinId.toUpperCase() === 'ETH');

  const btcHref = btcHolding ? `/portfolio/${btcHolding.portfolioId}/${btcHolding.coinId}` : undefined;
  const ethHref = ethHolding ? `/portfolio/${ethHolding.portfolioId}/${ethHolding.coinId}` : undefined;

  const cards = buildOverviewCards(
    closedPnlSum,
    btcHolding?.totalAmount ?? 0,
    btcHolding?.totalCost ?? 0,
    btcHolding?.avgCost ?? 0,
    ethHolding?.totalAmount ?? 0,
    ethHolding?.totalCost ?? 0,
    ethHolding?.avgCost ?? 0,
    btcHref,
    ethHref,
  );

  return (
    <DashboardOverview
      cards={cards}
      allHoldings={allHoldings}
      portfolioCount={portfolioCount}
      orders={recentOrders}
      assetSummary={assetSummary}
    />
  );
}
