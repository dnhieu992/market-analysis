import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
import { formatDateTime } from '@web/shared/lib/format';
import { DashboardOverview } from '@web/widgets/dashboard-overview/dashboard-overview';

async function loadDashboardData() {
  const client = createServerApiClient();
  try {
    const [orders, analysisRuns] = await Promise.all([
      client.fetchOrders(),
      client.fetchAnalysisRuns()
    ]);
    return { orders, analysisRuns };
  } catch {
    return { orders: [] as DashboardOrder[], analysisRuns: [] };
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
      positive: closedOrders.length === 0 ? undefined : totalPnl >= 0
    }
  ];
}

export default async function OverviewPage() {
  const { orders, analysisRuns } = await loadDashboardData();
  const cards = buildOverviewCards(orders);
  const lastUpdated =
    analysisRuns[0]?.createdAt instanceof Date
      ? formatDateTime(analysisRuns[0].createdAt)
      : 'just now';

  return <DashboardOverview cards={cards} lastUpdatedLabel={lastUpdated} />;
}
