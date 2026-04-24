import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
import { formatDateTime } from '@web/shared/lib/format';
import { DashboardOverview } from '@web/widgets/dashboard-overview/dashboard-overview';

async function loadDashboardData() {
  const client = createServerApiClient();
  try {
    const [orders, analysisRuns, portfolios] = await Promise.all([
      client.fetchOrders(),
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

    return { orders, analysisRuns, allHoldings, portfolioCount: portfolios.length };
  } catch {
    return { orders: [] as DashboardOrder[], analysisRuns: [], allHoldings: [], portfolioCount: 0 };
  }
}

function buildOverviewCards(orders: DashboardOrder[]) {
  const openOrders = orders.filter((o) => o.status === 'open');
  const closedOrders = orders.filter((o) => o.status === 'closed');
  const totalPnl = closedOrders.reduce((sum, o) => sum + (o.pnl ?? 0), 0);
  const totalPnlStr =
    (totalPnl >= 0 ? '+' : '') +
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(totalPnl);

  return [
    {
      label: 'Open Orders',
      value: String(openOrders.length),
      detail: 'Manual positions currently active.'
    },
    {
      label: 'Closed Orders',
      value: String(closedOrders.length),
      detail: 'Finished trades kept in history.'
    },
    {
      label: 'Total Profit / Loss',
      value: closedOrders.length === 0 ? '--' : totalPnlStr,
      detail: 'All-time realized P/L across closed trades.',
      positive: closedOrders.length === 0 ? undefined : totalPnl >= 0,
      href: '/pnl-calendar'
    }
  ];
}

export default async function OverviewPage() {
  const { orders, analysisRuns, allHoldings, portfolioCount } = await loadDashboardData();
  const cards = buildOverviewCards(orders);
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
      orders={orders}
    />
  );
}
