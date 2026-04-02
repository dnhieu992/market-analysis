import { TradeForm } from '@web/features/create-trade/create-trade-form';
import type { DashboardOrder } from '@web/shared/api/types';

import { TradesTable } from './trades-table';

type TradesHistoryProps = Readonly<{
  orders: DashboardOrder[];
}>;

export function TradesHistory({ orders }: TradesHistoryProps) {
  return (
    <main className="dashboard-shell trades-shell">
      <section className="hero-card trades-hero">
        <div className="hero-copy">
          <p className="eyebrow">Trading History</p>
          <p className="hero-tag">Open trading history</p>
          <h1>Manual Trade Desk</h1>
          <p className="lead">
            Review stored trades and add new positions directly from the browser.
          </p>
        </div>
        <div className="hero-status">
          <span className="status-dot" />
          <span>{orders.length} stored trade(s)</span>
        </div>
      </section>

      <section className="trades-layout">
        <TradeForm />
        <TradesTable orders={orders} />
      </section>
    </main>
  );
}
