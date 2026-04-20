import type { DashboardOrder } from '@web/shared/api/types';
import { HoldingsAllocationChart } from '@web/widgets/holdings-allocation-chart/holdings-allocation-chart';
import { OverviewCards } from './overview-cards';

type OverviewCard = Readonly<{
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
}>;

type HoldingEntry = {
  coinId: string;
  totalAmount: number;
  totalCost: number;
};

type DashboardOverviewProps = Readonly<{
  cards: readonly OverviewCard[];
  lastUpdatedLabel: string;
  allHoldings: HoldingEntry[];
  portfolioCount: number;
  orders: DashboardOrder[];
}>;

export function DashboardOverview({ cards, lastUpdatedLabel, allHoldings, portfolioCount }: DashboardOverviewProps) {
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

      <HoldingsAllocationChart holdings={allHoldings} portfolioCount={portfolioCount} />
    </main>
  );
}
