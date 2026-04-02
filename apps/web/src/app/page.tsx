import { createApiClient } from '../lib/api';
import { formatConfidence, formatDateTime } from '../lib/format';
import type { DashboardAnalysisRun, DashboardOrder, DashboardSignal } from '../lib/types';
import { OverviewCards } from '../components/dashboard/overview-cards';
import { RecentAnalysisPanel } from '../components/dashboard/recent-analysis-panel';
import { RecentOrdersPanel } from '../components/dashboard/recent-orders-panel';
import { QuickActions } from '../components/dashboard/quick-actions';

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

export default async function HomePage() {
  const { orders, signals, analysisRuns } = await loadDashboardData();
  const cards = buildOverviewCards(orders, signals);
  const lastUpdated =
    analysisRuns[0]?.createdAt && analysisRuns[0]?.createdAt instanceof Date
      ? formatDateTime(analysisRuns[0].createdAt)
      : 'just now';

  return (
    <main className="dashboard-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Market Analysis Bot</p>
          <h1>Overview Dashboard</h1>
          <p className="lead">
            Track manual trades, review worker-generated analysis, and keep the full trading
            history in one place.
          </p>
        </div>
        <div className="hero-status">
          <span className="status-dot" />
          <span>Last refresh {lastUpdated}</span>
        </div>
      </section>

      <OverviewCards cards={cards} />

      <section className="content-grid">
        <RecentAnalysisPanel signals={signals} analysisRuns={analysisRuns} />
        <RecentOrdersPanel orders={orders} />
      </section>

      <QuickActions lastUpdatedLabel={lastUpdated} />
    </main>
  );
}
