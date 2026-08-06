import type { AssetSummary, DashboardOrder } from '@web/shared/api/types';
import { DASHBOARD_POLL_MS } from '@web/shared/lib/use-poll';
import { AssetSummaryCard } from '@web/widgets/asset-summary-card/asset-summary-card';
import { HoldingsAllocationChart } from '@web/widgets/holdings-allocation-chart/holdings-allocation-chart';
import { AutoRefresh } from './auto-refresh';
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
  assetSummary: AssetSummary | null;
}>;

export function DashboardOverview({ cards, allHoldings, portfolioCount, assetSummary }: DashboardOverviewProps) {
  return (
    <main className="dashboard-shell">
      {/* Makes the whole page a live view: every server-rendered figure re-pulls on this
          interval, and the client-side price feeds below run on the same one. */}
      <AutoRefresh intervalMs={DASHBOARD_POLL_MS} />

      <OverviewCards cards={cards} />

      {/* The whole book (/my-asset) first, then the spot-portfolio breakdown. */}
      {assetSummary ? <AssetSummaryCard summary={assetSummary} /> : null}

      <HoldingsAllocationChart holdings={allHoldings} portfolioCount={portfolioCount} />
    </main>
  );
}
