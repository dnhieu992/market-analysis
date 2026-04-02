import { createApiClient } from '@web/shared/api/client';
import type { DashboardAnalysisRun, DashboardOrder, DashboardSignal } from '@web/shared/api/types';
import { formatConfidence, formatDateTime } from '@web/shared/lib/format';
import { DashboardOverview } from '@web/widgets/dashboard-overview/dashboard-overview';

async function loadDashboardData() {
  const client = createApiClient();

  try {
    const [orders, signals, analysisRuns] = await Promise.all([
      client.fetchOrders(),
      client.fetchSignals(),
      client.fetchAnalysisRuns()
    ]);

    return { orders, signals, analysisRuns };
  } catch {
    return {
      orders: [] as DashboardOrder[],
      signals: [] as DashboardSignal[],
      analysisRuns: [] as DashboardAnalysisRun[]
    };
  }
}

function buildOverviewCards(orders: DashboardOrder[], signals: DashboardSignal[]) {
  const openOrders = orders.filter((order) => order.status === 'open');
  const closedOrders = orders.filter((order) => order.status === 'closed');
  const recentSignals = signals.slice(0, 5);
  const confidenceAverage =
    recentSignals.length === 0
      ? '--'
      : formatConfidence(
          recentSignals.reduce((sum, signal) => sum + signal.confidence, 0) / recentSignals.length
        );

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
      label: 'Recent Signals',
      value: String(signals.length),
      detail: 'Worker outputs available for review.'
    },
    {
      label: 'Avg. Confidence',
      value: confidenceAverage,
      detail: 'Average confidence across the latest signals.'
    }
  ] as const;
}

export default async function OverviewPage() {
  const { orders, signals, analysisRuns } = await loadDashboardData();
  const cards = buildOverviewCards(orders, signals);
  const lastUpdated =
    analysisRuns[0]?.createdAt && analysisRuns[0]?.createdAt instanceof Date
      ? formatDateTime(analysisRuns[0].createdAt)
      : 'just now';

  return (
    <DashboardOverview
      cards={cards}
      orders={orders}
      signals={signals}
      analysisRuns={analysisRuns}
      lastUpdatedLabel={lastUpdated}
    />
  );
}
