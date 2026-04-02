import { formatDateTime, formatPrice } from '../../lib/format';
import type { DashboardOrder } from '../../lib/types';
import { CloseTradeForm } from './close-trade-form';
import { TradeStatusPill } from './trade-status-pill';

type TradesTableProps = Readonly<{
  orders: DashboardOrder[];
}>;

export function TradesTable({ orders }: TradesTableProps) {
  if (orders.length === 0) {
    return (
      <article className="panel">
        <h2>Trade History</h2>
        <p>No manual trades yet. Use the form to open a position.</p>
      </article>
    );
  }

  return (
    <article className="panel">
      <div className="table-header">
        <div>
          <h2>Trade History</h2>
          <p>Manual positions stored in the app.</p>
        </div>
      </div>

      <div className="trades-table" role="table" aria-label="trade history table">
        <div className="trades-row trades-row-head" role="row">
          <span role="columnheader">Symbol</span>
          <span role="columnheader">Side</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Entry</span>
          <span role="columnheader">Opened</span>
          <span role="columnheader">Actions</span>
        </div>

        {orders.map((order) => (
          <div key={order.id} className="trades-row" role="row">
            <span role="cell" className="trades-symbol">
              {order.symbol}
            </span>
            <span role="cell">{order.side}</span>
            <span role="cell">
              <TradeStatusPill status={order.status} />
            </span>
            <span role="cell">{formatPrice(order.entryPrice)}</span>
            <span role="cell">{formatDateTime(order.openedAt)}</span>
            <span role="cell">
              <CloseTradeForm orderId={order.id} status={order.status} />
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
