import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
import { formatDateTime } from '@web/shared/lib/format';
import { DashboardOverview } from '@web/widgets/dashboard-overview/dashboard-overview';

async function loadDashboardData() {
  const client = createServerApiClient();
  try {
    const [paginatedOrders, analysisRuns, portfolios] = await Promise.all([
      client.fetchOrders({ pageSize: 20 }),
      client.fetchAnalysisRuns(),
      client.fetchPortfolios(),
    ]);

    // fetch holdings for all portfolios in parallel
    const holdingsByPortfolio = await Promise.all(
      portfolios.map((p) => client.fetchHoldings(p.id).catch(() => []))
    );

    // aggregate by coinId across all portfolios
    const map = new Map<string, { totalAmount: number; totalCost: number; realizedPnl: number }>();
    for (const holdings of holdingsByPortfolio) {
      for (const h of holdings) {
        const existing = map.get(h.coinId);
        if (existing) {
          existing.totalAmount += h.totalAmount;
          existing.totalCost += h.totalInvested;
          existing.realizedPnl += h.realizedPnl;
        } else {
          map.set(h.coinId, { totalAmount: h.totalAmount, totalCost: h.totalInvested, realizedPnl: h.realizedPnl });
        }
      }
    }

    const allHoldings = Array.from(map.entries()).map(([coinId, v]) => ({
      coinId,
      totalAmount: v.totalAmount,
      totalCost: v.totalCost,
      realizedPnl: v.realizedPnl,
    }));

    return {
      recentOrders: paginatedOrders.data,
      openOrderCount: paginatedOrders.openOrders.length,
      closedOrderCount: paginatedOrders.total - paginatedOrders.openOrders.length,
      closedPnlSum: paginatedOrders.closedPnlSum,
      analysisRuns,
      allHoldings,
      portfolioCount: portfolios.length,
    };
  } catch {
    return {
      recentOrders: [] as DashboardOrder[],
      openOrderCount: 0,
      closedOrderCount: 0,
      closedPnlSum: 0,
      analysisRuns: [],
      allHoldings: [],
      portfolioCount: 0,
    };
  }
}

function buildOverviewCards(openOrderCount: number, closedOrderCount: number, closedPnlSum: number) {
  const totalPnlStr =
    (closedPnlSum >= 0 ? '+' : '') +
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(closedPnlSum);

  return [
    {
      label: 'Open Orders',
      value: String(openOrderCount),
      detail: 'Manual positions currently active.'
    },
    {
      label: 'Closed Orders',
      value: String(closedOrderCount),
      detail: 'Finished trades kept in history.'
    },
    {
      label: 'Total Profit / Loss',
      value: closedOrderCount === 0 ? '--' : totalPnlStr,
      detail: 'All-time realized P/L across closed trades.',
      positive: closedOrderCount === 0 ? undefined : closedPnlSum >= 0,
      href: '/pnl-calendar'
    }
  ];
}

export default async function OverviewPage() {
  const { recentOrders, openOrderCount, closedOrderCount, closedPnlSum, analysisRuns, allHoldings, portfolioCount } =
    await loadDashboardData();
  const cards = buildOverviewCards(openOrderCount, closedOrderCount, closedPnlSum);
  const lastUpdated =
    analysisRuns[0]?.createdAt instanceof Date
      ? formatDateTime(analysisRuns[0].createdAt)
      : 'just now';

  return (
    <DashboardOverview
      cards={cards}
      lastUpdatedLabel={lastUpdated}
      allHoldings={allHoldings}
      portfolioCount={portfolioCount}
      orders={recentOrders}
    />
  );
}
