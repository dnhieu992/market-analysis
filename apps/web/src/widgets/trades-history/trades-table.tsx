import { formatDateTime, formatPrice } from '@web/shared/lib/format';
import type { DashboardOrder } from '@web/shared/api/types';

import { OrderStatusPill } from '@web/entities/order/order-status-pill';

type TradesTableProps = Readonly<{
  orders: DashboardOrder[];
  onAddTrade: () => void;
  onAddMultiple: () => void;
  onCloseTrade: (orderId: string) => void;
}>;

function TableActions({ onAddTrade, onAddMultiple }: { onAddTrade: () => void; onAddMultiple: () => void }) {
  return (
    <div className="table-actions">
      <button className="btn btn--primary" onClick={onAddTrade}>+ Add Trade</button>
      <button className="btn btn--secondary" onClick={onAddMultiple}>Add Multiple Orders</button>
    </div>
  );
}

export function TradesTable({ orders, onAddTrade, onAddMultiple, onCloseTrade }: TradesTableProps) {
  if (orders.length === 0) {
    return (
      <article className="panel">
        <div className="table-header">
          <div>
            <h2>Trade History</h2>
            <p>No manual trades yet.</p>
          </div>
          <TableActions onAddTrade={onAddTrade} onAddMultiple={onAddMultiple} />
        </div>
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
        <TableActions onAddTrade={onAddTrade} onAddMultiple={onAddMultiple} />
      </div>

      <div className="trades-table" role="table" aria-label="trade history table">
        <div className="trades-row trades-row-head" role="row">
          <span role="columnheader">Symbol</span>
          <span role="columnheader">Side</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Entry</span>
          <span role="columnheader">Volume</span>
          <span role="columnheader">Opened</span>
          <span role="columnheader">Actions</span>
        </div>

        {orders.map((order) => (
          <div key={order.id} className="trades-row" role="row">
            <span role="cell" className="trades-symbol">{order.symbol}</span>
            <span role="cell">{order.side}</span>
            <span role="cell"><OrderStatusPill status={order.status} /></span>
            <span role="cell">{formatPrice(order.entryPrice)}</span>
            <span role="cell">{order.quantity != null ? `${order.quantity} USDT` : '—'}</span>
            <span role="cell">{formatDateTime(order.openedAt)}</span>
            <span role="cell">
              {order.status.toLowerCase() === 'open' && (
                <button className="btn btn--secondary" onClick={() => onCloseTrade(order.id)}>
                  Close Trade
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
