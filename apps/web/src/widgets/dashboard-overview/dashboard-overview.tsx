import type { DashboardAnalysisRun, DashboardOrder, DashboardSignal } from '@web/shared/api/types';
import { HoldingsAllocationChart } from '@web/widgets/holdings-allocation-chart/holdings-allocation-chart';
import { QuickActions } from './quick-actions';
import { RecentAnalysisPanel } from './recent-analysis-panel';
import { RecentOrdersPanel } from './recent-orders-panel';

type HoldingEntry = {
  coinId: string;
  totalAmount: number;
  totalCost: number;
};

type DashboardOverviewProps = Readonly<{
  cards: readonly unknown[];
  lastUpdatedLabel: string;
  allHoldings: HoldingEntry[];
  portfolioCount: number;
  orders: DashboardOrder[];
  signals: DashboardSignal[];
  analysisRuns: DashboardAnalysisRun[];
}>;

export function DashboardOverview({ lastUpdatedLabel, allHoldings, portfolioCount, orders, signals, analysisRuns }: DashboardOverviewProps) {
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

      <HoldingsAllocationChart holdings={allHoldings} portfolioCount={portfolioCount} />

      <section className="content-grid">
        <RecentAnalysisPanel signals={signals} analysisRuns={analysisRuns} />
        <RecentOrdersPanel orders={orders} />
      </section>

      <QuickActions lastUpdatedLabel={lastUpdatedLabel} />
    </main>
  );
}
