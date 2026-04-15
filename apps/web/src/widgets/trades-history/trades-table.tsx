'use client';

import { useState } from 'react';
import { formatDateTime } from '@web/shared/lib/format';

function formatDecimal(value: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}
import type { DashboardOrder } from '@web/shared/api/types';

import { OrderStatusPill } from '@web/entities/order/order-status-pill';

type StatusFilter = 'all' | 'open' | 'closed';

type TradesTableProps = Readonly<{
  orders: DashboardOrder[];
  onAddTrade: () => void;
  onAddMultiple: () => void;
  onCloseTrade: (order: DashboardOrder) => void;
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

function TableActions({ onAddTrade, onAddMultiple }: { onAddTrade: () => void; onAddMultiple: () => void }) {
  return (
    <div className="table-actions">
      <button className="btn btn--primary" onClick={onAddTrade}>+ Add Trade</button>
      <button className="btn btn--secondary" onClick={onAddMultiple}>Add Multiple Orders</button>
    </div>
  );
}

function PnlCell({ pnl }: { pnl: number | null | undefined }) {
  if (pnl == null) return <span>—</span>;
  const isPositive = pnl >= 0;
  return (
    <span style={{ color: isPositive ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)', fontWeight: 600 }}>
      {isPositive ? '+' : ''}{formatDecimal(pnl)}
    </span>
  );
}

export function TradesTable({ orders, onAddTrade, onAddMultiple, onCloseTrade, onEditTrade, onRemoveTrade }: TradesTableProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const openCount = orders.filter(o => o.status.toLowerCase() === 'open').length;
  const closedCount = orders.filter(o => o.status.toLowerCase() === 'closed').length;

  const filteredOrders = orders.filter(o => {
    if (statusFilter === 'open') return o.status.toLowerCase() === 'open';
    if (statusFilter === 'closed') return o.status.toLowerCase() === 'closed';
    return true;
  });

  return (
    <article className="panel">
      <div className="table-header">
        <div>
          <h2>Trade History</h2>
          {orders.length === 0 ? (
            <p>No manual trades yet.</p>
          ) : (
            <p>Manual positions stored in the app.</p>
          )}
        </div>
        <TableActions onAddTrade={onAddTrade} onAddMultiple={onAddMultiple} />
      </div>

      {orders.length > 0 && (
        <div className="trades-filter-bar">
          <button
            className={`trades-filter-badge${statusFilter === 'all' ? ' trades-filter-badge--active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All <span className="trades-filter-count">{orders.length}</span>
          </button>
          <button
            className={`trades-filter-badge trades-filter-badge--open${statusFilter === 'open' ? ' trades-filter-badge--active' : ''}`}
            onClick={() => setStatusFilter('open')}
          >
            Open <span className="trades-filter-count">{openCount}</span>
          </button>
          <button
            className={`trades-filter-badge trades-filter-badge--closed${statusFilter === 'closed' ? ' trades-filter-badge--active' : ''}`}
            onClick={() => setStatusFilter('closed')}
          >
            Closed <span className="trades-filter-count">{closedCount}</span>
          </button>
        </div>
      )}

      {filteredOrders.length === 0 ? null : (
        <div className="trades-table" role="table" aria-label="trade history table">
          <div className="trades-row trades-row-head" role="row">
            <span role="columnheader">Symbol</span>
            <span role="columnheader">Side</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Entry Price</span>
            <span role="columnheader">Close Price</span>
            <span role="columnheader">Volume (USD)</span>
            <span role="columnheader">PnL</span>
            <span role="columnheader">Opened</span>
            <span role="columnheader">Closed</span>
            <span role="columnheader">Actions</span>
          </div>

          {filteredOrders.map((order) => (
            <div key={order.id} className="trades-row" role="row">
              <span role="cell" className="trades-symbol">{order.symbol}</span>
              <span role="cell">
                <span className={`trades-side-badge trades-side-badge--${order.side.toLowerCase()}`}>
                  {order.side}
                </span>
              </span>
              <span role="cell"><OrderStatusPill status={order.status} /></span>
              <span role="cell">{formatDecimal(order.entryPrice)}</span>
              <span role="cell">{order.closePrice != null ? formatDecimal(order.closePrice) : '—'}</span>
              <span role="cell">{order.quantity != null ? formatDecimal(order.quantity * order.entryPrice) : '—'}</span>
              <span role="cell"><PnlCell pnl={order.pnl} /></span>
              <span role="cell">{formatDateTime(order.openedAt)}</span>
              <span role="cell">{order.closedAt ? formatDateTime(order.closedAt) : '—'}</span>
              <span role="cell" className="trades-actions">
                {order.status.toLowerCase() === 'open' && (
                  <button
                    className="btn--icon btn--icon-success"
                    data-tooltip="Close Trade"
                    aria-label="Close Trade"
                    onClick={() => onCloseTrade(order)}
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
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
