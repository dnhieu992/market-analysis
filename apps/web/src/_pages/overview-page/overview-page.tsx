import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
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
      realizedPnl: v.realizedPnl,
      portfolioId: v.portfolioId,
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

const BTC_TARGET = 1;

function buildOverviewCards(
  openOrderCount: number,
  closedOrderCount: number,
  closedPnlSum: number,
  btcAmount: number,
  btcCost: number,
  btcHref?: string,
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

  const totalOrders = openOrderCount + closedOrderCount;

  return [
    {
      label: 'BTC Accumulated',
      value: btcStr,
      detail: btcCostStr ? `${btcPct}% toward ${BTC_TARGET} BTC · ${btcCostStr} invested` : `${btcPct}% toward ${BTC_TARGET} BTC goal`,
      progress: btcProgress,
      progressLabel: btcRemaining > 0 ? `${btcRemainingStr} BTC remaining` : 'Goal reached!',
      href: btcHref,
    },
    {
      label: 'Orders',
      value: String(totalOrders),
      detail: `${openOrderCount} open · ${closedOrderCount} closed`,
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
  const { recentOrders, openOrderCount, closedOrderCount, closedPnlSum, allHoldings, portfolioCount } =
    await loadDashboardData();
  const btcHolding = allHoldings.find((h) => h.coinId.toUpperCase() === 'BTC');
  const btcHref = btcHolding ? `/portfolio/${btcHolding.portfolioId}/${btcHolding.coinId}` : undefined;
  const cards = buildOverviewCards(openOrderCount, closedOrderCount, closedPnlSum, btcHolding?.totalAmount ?? 0, btcHolding?.totalCost ?? 0, btcHref);

  return (
    <DashboardOverview
      cards={cards}
      allHoldings={allHoldings}
      portfolioCount={portfolioCount}
      orders={recentOrders}
    />
  );
}
