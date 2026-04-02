import { createApiClient } from '../../lib/api';
import type { DashboardOrder } from '../../lib/types';
import { TradeForm } from '../../components/trades/trade-form';
import { TradesTable } from '../../components/trades/trades-table';

async function loadOrders() {
  const client = createApiClient();

  try {
    return await client.fetchOrders();
  } catch {
    return [] as DashboardOrder[];
  }
}

export default async function TradesPage() {
  const orders = await loadOrders();

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
