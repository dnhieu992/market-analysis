'use client';

import { useState } from 'react';
import type { DashboardOrder } from '@web/shared/api/types';

type StatusFilter = 'all' | 'open' | 'closed';
type DateFilter = 'today' | '7D' | '30D' | 'custom';

function getDateRange(filter: DateFilter, customFrom: string, customTo: string): { from: Date; to: Date } | null {
  const now = new Date();
  if (filter === 'today') {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { from, to };
  }
  if (filter === '7D') {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }
  if (filter === '30D') {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }
  if (filter === 'custom' && customFrom && customTo) {
    return { from: new Date(customFrom), to: new Date(customTo + 'T23:59:59') };
  }
  return null;
}

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
      <span className="tt-pnl-card__note">Closed trades in selected period</span>
    </div>
  );
}

export function TradesTable({ orders, onAddTrade, onAddMultiple, onCloseTrade, onEditTrade, onRemoveTrade }: TradesTableProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustomPopover, setShowCustomPopover] = useState(false);

  const dateRange = dateFilter ? getDateRange(dateFilter, customFrom, customTo) : null;

  const dateFilteredOrders = orders.filter(o => {
    if (!dateRange) return true;
    const opened = new Date(o.openedAt);
    return opened >= dateRange.from && opened <= dateRange.to;
  });

  const openCount = dateFilteredOrders.filter(o => o.status.toLowerCase() === 'open').length;
  const closedCount = dateFilteredOrders.filter(o => o.status.toLowerCase() === 'closed').length;

  const filteredOrders = dateFilteredOrders.filter(o => {
    if (statusFilter === 'open') return o.status.toLowerCase() === 'open';
    if (statusFilter === 'closed') return o.status.toLowerCase() === 'closed';
    return true;
  });

  function handleDateFilter(f: DateFilter) {
    if (f === 'custom') {
      setShowCustomPopover(v => !v);
      setDateFilter('custom');
    } else {
      setShowCustomPopover(false);
      setDateFilter(prev => prev === f ? null : f);
    }
  }

  function applyCustom() {
    if (customFrom && customTo) {
      setDateFilter('custom');
      setShowCustomPopover(false);
    }
  }

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
          <TotalPnlCard orders={filteredOrders} />
        </div>
      )}

      {orders.length > 0 && (
        <div className="trades-filter-bar">
          {/* Status filter */}
          <button
            className={`trades-filter-badge${statusFilter === 'all' ? ' trades-filter-badge--active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All <span className="trades-filter-count">{dateFilteredOrders.length}</span>
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

          {/* Divider */}
          <span className="trades-filter-divider" />

          {/* Date filter */}
          {(['today', '7D', '30D'] as DateFilter[]).map(f => (
            <button
              key={f}
              className={`trades-filter-badge trades-filter-badge--date${dateFilter === f ? ' trades-filter-badge--active' : ''}`}
              onClick={() => handleDateFilter(f)}
            >
              {f}
            </button>
          ))}

          <div className="trades-date-custom-wrap">
            <button
              className={`trades-filter-badge trades-filter-badge--date${dateFilter === 'custom' ? ' trades-filter-badge--active' : ''}`}
              onClick={() => handleDateFilter('custom')}
            >
              {dateFilter === 'custom' && customFrom && customTo
                ? `${customFrom} – ${customTo}`
                : 'Custom'}
            </button>
            {showCustomPopover && (
              <div className="trades-date-popover">
                <label className="trades-date-popover__label">From</label>
                <input
                  type="date"
                  className="trades-date-popover__input"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                />
                <label className="trades-date-popover__label">To</label>
                <input
                  type="date"
                  className="trades-date-popover__input"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                />
                <button
                  className="btn btn--primary trades-date-popover__apply"
                  onClick={applyCustom}
                  disabled={!customFrom || !customTo}
                >
                  Apply
                </button>
              </div>
            )}
          </div>

          {dateFilter && (
            <button
              className="trades-filter-badge trades-filter-badge--clear"
              onClick={() => { setDateFilter(null); setShowCustomPopover(false); setCustomFrom(''); setCustomTo(''); }}
            >
              ✕ Clear date
            </button>
          )}
        </div>
      )}

      {filteredOrders.length > 0 && (
        <div className="tt-wrap tt-card-wrap">
          <table className="tt tt-card">
            <thead>
              <tr>
                <th>Name</th>
                <th>Open</th>
                <th>Close</th>
                <th>Volume</th>
                <th>Source</th>
                <th>Strategy</th>
                <th>Profit/Loss</th>
                <th>Order Type</th>
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
                    <td data-label="Name" data-full="">
                      <div className="tt-name">
                        <button className="tt-symbol-btn" onClick={() => onEditTrade(order)}>{order.symbol}</button>
                        <span className={`tt-side tt-side--${order.side.toLowerCase()}`}>{order.side.toUpperCase()}</span>
                      </div>
                    </td>

                    {/* OPEN */}
                    <td data-label="Open">
                      <div className="tt-price-date">
                        <span>Price: {formatPrice(order.entryPrice)}</span>
                        <span>Date: {formatDate(order.openedAt)}</span>
                      </div>
                    </td>

                    {/* CLOSE */}
                    <td data-label="Close">
                      <div className="tt-price-date">
                        <span>Price: {order.closePrice != null ? formatPrice(order.closePrice) : '-'}</span>
                        <span>Date: {order.closedAt ? formatDate(order.closedAt) : '-'}</span>
                      </div>
                    </td>

                    {/* VOLUME */}
                    <td data-label="Volume">{order.quantity != null ? formatVolume(order.quantity * order.entryPrice) : '-'}</td>

                    {/* SOURCE */}
                    <td data-label="Source">{order.broker ?? '-'}</td>

                    {/* STRATEGY */}
                    <td data-label="Strategy">{order.exchange ?? '-'}</td>

                    {/* PROFIT/LOSS */}
                    <td data-label="P/L"><PnlCell pnl={order.pnl} /></td>

                    {/* ORDER TYPE */}
                    <td data-label="Order Type">{order.orderType ?? '-'}</td>

                    {/* STATUS */}
                    <td data-label="Status"><StatusPill status={order.status} /></td>

                    {/* ACTIONS */}
                    <td data-label="Actions" data-full="">
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
