import { formatDateTime } from '@web/shared/lib/format';

function formatDecimal(value: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}
import type { DashboardOrder } from '@web/shared/api/types';

import { OrderStatusPill } from '@web/entities/order/order-status-pill';

type TradesTableProps = Readonly<{
  orders: DashboardOrder[];
  onAddTrade: () => void;
  onAddMultiple: () => void;
  onCloseTrade: (orderId: string) => void;
  onEditTrade: (order: DashboardOrder) => void;
  onRemoveTrade: (orderId: string) => void;
}>;

function IconClose() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function TradeCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="trades-cell">
      <span className="trades-cell-label">{label}</span>
      <div className="trades-cell-value">{children}</div>
    </div>
  );
}

function TableActions({ onAddTrade, onAddMultiple }: { onAddTrade: () => void; onAddMultiple: () => void }) {
  return (
    <div className="table-actions">
      <button className="btn btn--primary" onClick={onAddTrade}>+ Add Trade</button>
      <button className="btn btn--secondary" onClick={onAddMultiple}>Add Multiple Orders</button>
    </div>
  );
}

export function TradesTable({ orders, onAddTrade, onAddMultiple, onCloseTrade, onEditTrade, onRemoveTrade }: TradesTableProps) {
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
        {orders.map((order) => (
          <div key={order.id} className="trades-row" role="row">
            <TradeCell label="Symbol">{order.symbol}</TradeCell>
            <TradeCell label="Side">
              <span className={`trades-side-badge trades-side-badge--${order.side.toLowerCase()}`}>
                {order.side}
              </span>
            </TradeCell>
            <TradeCell label="Status"><OrderStatusPill status={order.status} /></TradeCell>
            <TradeCell label="Entry Price">{formatDecimal(order.entryPrice)}</TradeCell>
            <TradeCell label="Volume (USD)">
              {order.quantity != null ? formatDecimal(order.quantity * order.entryPrice) : '—'}
            </TradeCell>
            <TradeCell label="Opened">{formatDateTime(order.openedAt)}</TradeCell>
            <div className="trades-cell trades-cell-actions">
              <span className="trades-cell-label">Actions</span>
              <div className="trades-actions">
                {order.status.toLowerCase() === 'open' && (
                  <button
                    className="btn--icon btn--icon-success"
                    data-tooltip="Close Trade"
                    aria-label="Close Trade"
                    onClick={() => onCloseTrade(order.id)}
                  >
                    <IconClose />
                  </button>
                )}
                <button
                  className="btn--icon"
                  data-tooltip="Edit"
                  aria-label="Edit Trade"
                  onClick={() => onEditTrade(order)}
                >
                  <IconEdit />
                </button>
                <button
                  className="btn--icon btn--icon-danger"
                  data-tooltip="Delete"
                  aria-label="Delete Trade"
                  onClick={() => onRemoveTrade(order.id)}
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
