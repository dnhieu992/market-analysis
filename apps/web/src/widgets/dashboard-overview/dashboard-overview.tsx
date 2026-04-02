import type { DashboardAnalysisRun, DashboardOrder, DashboardSignal } from '@web/shared/api/types';

import { OverviewCards } from './overview-cards';
import { QuickActions } from './quick-actions';
import { RecentAnalysisPanel } from './recent-analysis-panel';
import { RecentOrdersPanel } from './recent-orders-panel';

type OverviewCard = Readonly<{
  label: string;
  value: string;
  detail: string;
}>;

type DashboardOverviewProps = Readonly<{
  cards: readonly OverviewCard[];
  orders: DashboardOrder[];
  signals: DashboardSignal[];
  analysisRuns: DashboardAnalysisRun[];
  lastUpdatedLabel: string;
}>;

export function DashboardOverview({
  cards,
  orders,
  signals,
  analysisRuns,
  lastUpdatedLabel
}: DashboardOverviewProps) {
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
          <span>Last refresh {lastUpdatedLabel}</span>
        </div>
      </section>

      <OverviewCards cards={cards} />

      <section className="content-grid">
        <RecentAnalysisPanel signals={signals} analysisRuns={analysisRuns} />
        <RecentOrdersPanel orders={orders} />
      </section>

      <QuickActions lastUpdatedLabel={lastUpdatedLabel} />
    </main>
  );
}
