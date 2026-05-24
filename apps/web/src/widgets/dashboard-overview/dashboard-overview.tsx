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
  realizedPnl: number;
  portfolioId: string;
};

type DashboardOverviewProps = Readonly<{
  cards: readonly OverviewCard[];
  allHoldings: HoldingEntry[];
  portfolioCount: number;
  orders: DashboardOrder[];
}>;

export function DashboardOverview({ cards, allHoldings, portfolioCount }: DashboardOverviewProps) {
  return (
    <main className="dashboard-shell">
      <OverviewCards cards={cards} />

      <HoldingsAllocationChart holdings={allHoldings} portfolioCount={portfolioCount} />
    </main>
  );
}
