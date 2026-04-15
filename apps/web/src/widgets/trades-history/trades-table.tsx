'use client';

import { useState } from 'react';
import type { DashboardOrder } from '@web/shared/api/types';

type StatusFilter = 'all' | 'open' | 'closed';

type TradesTableProps = Readonly<{
  orders: DashboardOrder[];
  onAddTrade: () => void;
  onAddMultiple: () => void;
  onCloseTrade: (order: DashboardOrder) => void;
  onEditTrade: (order: DashboardOrder) => void;
  onRemoveTrade: (orderId: string) => void;
}>;

function formatPrice(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '-';
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function IconCircleCheck() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-5" />
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

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (normalized === 'open') {
    return <span className="tt-status-pill tt-status-pill--opening">Opening</span>;
  }
  if (normalized === 'closed') {
    return <span className="tt-status-pill tt-status-pill--closed">Closed</span>;
  }
  return <span className="tt-status-pill">{status}</span>;
}

function PnlCell({ pnl }: { pnl: number | null | undefined }) {
  if (pnl == null) return <span className="tt-muted">-</span>;
  const isPositive = pnl >= 0;
  return (
    <span className={isPositive ? 'tt-pnl-positive' : 'tt-pnl-negative'}>
      {isPositive ? '+' : ''}{formatVolume(pnl)}
    </span>
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

function TotalPnlCard({ orders }: { orders: DashboardOrder[] }) {
  const closedOrders = orders.filter(o => o.status.toLowerCase() === 'closed');
  const total = closedOrders.reduce((sum, o) => sum + (o.pnl ?? 0), 0);
  const isPositive = total >= 0;

  return (
    <div className="tt-pnl-card">
      <span className="tt-pnl-card__label">Total Profit/Loss</span>
      <span className={`tt-pnl-card__value ${isPositive ? 'tt-pnl-card__value--positive' : 'tt-pnl-card__value--negative'}`}>
        {isPositive ? '+' : ''}{formatVolume(total)}
      </span>
      <span className="tt-pnl-card__note">Based on current filters (closed trades only)</span>
    </div>
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
          <p>{orders.length === 0 ? 'No manual trades yet.' : 'Manual positions stored in the app.'}</p>
        </div>
        <TableActions onAddTrade={onAddTrade} onAddMultiple={onAddMultiple} />
      </div>

      {orders.length > 0 && (
        <div className="tt-summary-bar">
          <TotalPnlCard orders={orders} />
        </div>
      )}

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

      {filteredOrders.length > 0 && (
        <div className="tt-wrap">
          <table className="tt">
            <thead>
              <tr>
                <th>Name</th>
                <th>Open</th>
                <th>Close</th>
                <th>Volume</th>
                <th>Source</th>
                <th>Profit/Loss</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const isOpen = order.status.toLowerCase() === 'open';
                return (
                  <tr key={order.id}>
                    {/* NAME */}
                    <td>
                      <div className="tt-name">
                        <button className="tt-symbol-btn" onClick={() => onEditTrade(order)}>{order.symbol}</button>
                        <span className={`tt-side tt-side--${order.side.toLowerCase()}`}>{order.side.toUpperCase()}</span>
                      </div>
                    </td>

                    {/* OPEN */}
                    <td>
                      <div className="tt-price-date">
                        <span>Price: {formatPrice(order.entryPrice)}</span>
                        <span>Date: {formatDate(order.openedAt)}</span>
                      </div>
                    </td>

                    {/* CLOSE */}
                    <td>
                      <div className="tt-price-date">
                        <span>Price: {order.closePrice != null ? formatPrice(order.closePrice) : '-'}</span>
                        <span>Date: {order.closedAt ? formatDate(order.closedAt) : '-'}</span>
                      </div>
                    </td>

                    {/* VOLUME */}
                    <td>{order.quantity != null ? formatVolume(order.quantity * order.entryPrice) : '-'}</td>

                    {/* SOURCE */}
                    <td>{order.broker ?? '-'}</td>

                    {/* PROFIT/LOSS */}
                    <td><PnlCell pnl={order.pnl} /></td>

                    {/* STATUS */}
                    <td><StatusPill status={order.status} /></td>

                    {/* ACTIONS */}
                    <td>
                      <div className="tt-actions">
                        {isOpen && (
                          <button
                            className="tt-btn tt-btn--success"
                            data-tooltip="Close Trade"
                            aria-label="Close Trade"
                            onClick={() => onCloseTrade(order)}
                          >
                            <IconCircleCheck />
                          </button>
                        )}
                        <button
                          className="tt-btn tt-btn--danger"
                          data-tooltip="Delete"
                          aria-label="Delete Trade"
                          onClick={() => onRemoveTrade(order.id)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
