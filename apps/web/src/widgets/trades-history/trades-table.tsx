'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createApiClient } from '@web/shared/api/client';
import type { DashboardOrder } from '@web/shared/api/types';

export function matchesSymbolFilter(symbol: string, filter: string): boolean {
  if (!filter) return true;
  return symbol.toLowerCase().includes(filter.toLowerCase());
}

export function matchesSourceFilter(broker: string | null | undefined, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  return broker != null && selected.has(broker);
}

export function calcUnrealizedPnl(
  entryPrice: number,
  currentPrice: number,
  quantity: number | null | undefined,
  side: string,
): number | null {
  if (quantity == null) return null;
  const diff = side.toLowerCase() === 'short'
    ? entryPrice - currentPrice
    : currentPrice - entryPrice;
  return diff * quantity;
}

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
  onViewNotes: (order: DashboardOrder) => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
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

function IconNotes() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="screenshot"
        className="lightbox-img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function NotesDialog({
  order,
  onClose,
  onImageDeleted,
}: {
  order: DashboardOrder;
  onClose: () => void;
  onImageDeleted: (url: string) => void;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);
  const images = order.images ?? [];
  const hasNote = !!order.note?.trim();
  const hasImages = images.length > 0;

  async function handleDeleteImage(url: string) {
    setDeletingUrl(url);
    try {
      const newImages = images.filter((u) => u !== url);
      await createApiClient().updateOrder(order.id, { images: newImages });
      onImageDeleted(url);
    } finally {
      setDeletingUrl(null);
    }
  }

  return (
    <>
      <div className="dialog-backdrop" onClick={onClose}>
        <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-header">
            <span className="dialog-title">Notes &amp; Screenshots — {order.symbol}</span>
            <button className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="dialog-body notes-dialog-body">
            {hasNote && (
              <div className="notes-section">
                <p className="notes-section-label">Note</p>
                <p className="notes-text">{order.note}</p>
              </div>
            )}
            {hasImages && (
              <div className="notes-section">
                <p className="notes-section-label">Screenshots ({images.length})</p>
                <div className="notes-images-grid">
                  {images.map((url) => (
                    <div key={url} className="notes-img-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt="trade screenshot"
                        onClick={() => setLightboxUrl(url)}
                      />
                      <button
                        className="notes-img-del"
                        aria-label="Delete image"
                        disabled={deletingUrl === url}
                        onClick={() => { void handleDeleteImage(url); }}
                      >
                        {deletingUrl === url ? '…' : '✕'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!hasNote && !hasImages && (
              <p className="tt-muted" style={{ padding: '8px 0' }}>No notes or screenshots for this trade.</p>
            )}
          </div>
        </div>
      </div>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
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

function TotalUnrealPnlCard({ orders, livePrices }: { orders: DashboardOrder[]; livePrices: Record<string, number> }) {
  const openOrders = orders; // caller is responsible for passing only open orders
  const allPricesLoaded = openOrders.length > 0 && openOrders.every(o => livePrices[o.symbol.toUpperCase()] != null);

  const total = openOrders.reduce((sum, o) => {
    const livePrice = livePrices[o.symbol.toUpperCase()];
    if (livePrice == null) return sum;
    const upnl = calcUnrealizedPnl(o.entryPrice, livePrice, o.quantity, o.side);
    return sum + (upnl ?? 0);
  }, 0);

  const isPositive = total >= 0;
  const isLoading = openOrders.length > 0 && !allPricesLoaded;

  return (
    <div className="tt-pnl-card">
      <span className="tt-pnl-card__label">Total Unrealized P/L</span>
      {isLoading ? (
        <span className="tt-pnl-card__value tt-muted">…</span>
      ) : openOrders.length === 0 ? (
        <span className="tt-pnl-card__value tt-muted">-</span>
      ) : (
        <span className={`tt-pnl-card__value ${isPositive ? 'tt-pnl-card__value--positive' : 'tt-pnl-card__value--negative'}`}>
          {isPositive ? '+' : ''}{formatVolume(total)}
        </span>
      )}
      <span className="tt-pnl-card__note">Open trades in selected period</span>
    </div>
  );
}

export function TradesTable({ orders, onAddTrade, onAddMultiple, onCloseTrade, onEditTrade, onRemoveTrade, onViewNotes, chatOpen, onToggleChat }: TradesTableProps) {
  const router = useRouter();
  const [autoReload, setAutoReload] = useState(false);
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (!autoReload) { setCountdown(30); return; }
    setCountdown(30);
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          router.refresh();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [autoReload, router]);

  const FILTERS_KEY = 'trades-filters';

  function loadFilters() {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as {
        statusFilter: StatusFilter;
        dateFilter: DateFilter | null;
        customFrom: string;
        customTo: string;
        sourceFilter: string[];
        nameFilter: string;
      };
    } catch { return null; }
  }

  const saved = typeof window !== 'undefined' ? loadFilters() : null;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(saved?.statusFilter ?? 'all');
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(saved?.dateFilter ?? null);
  const [customFrom, setCustomFrom] = useState(saved?.customFrom ?? '');
  const [customTo, setCustomTo] = useState(saved?.customTo ?? '');

  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set(saved?.sourceFilter ?? []));
  const [nameFilter, setNameFilter] = useState(saved?.nameFilter ?? '');
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({
        statusFilter,
        dateFilter,
        customFrom,
        customTo,
        sourceFilter: Array.from(sourceFilter),
        nameFilter,
      }));
    } catch { /* ignore quota errors */ }
  }, [statusFilter, dateFilter, customFrom, customTo, sourceFilter, nameFilter]);

  function resetFilters() {
    setStatusFilter('all');
    setDateFilter(null);
    setCustomFrom('');
    setCustomTo('');
    setSourceFilter(new Set());
    setNameFilter('');
    try { localStorage.removeItem(FILTERS_KEY); } catch { /* ignore */ }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node)) {
        setShowSourceDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const openSymbols = Array.from(new Set(
      orders.filter(o => o.status.toLowerCase() === 'open').map(o => o.symbol.toUpperCase())
    ));
    if (openSymbols.length === 0) return;
    const symbolsParam = encodeURIComponent(JSON.stringify(openSymbols));
    fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${symbolsParam}`)
      .then(r => r.json())
      .then((data: { symbol: string; price: string }[]) => {
        const map: Record<string, number> = {};
        for (const item of data) map[item.symbol] = Number(item.price);
        setLivePrices(map);
      })
      .catch(() => { /* silent — column shows '-' on failure */ });
  }, [orders]);

  const dateRange = dateFilter ? getDateRange(dateFilter, customFrom, customTo) : null;

  const dateFilteredOrders = orders.filter(o => {
    if (!dateRange) return true;
    const opened = new Date(o.openedAt);
    return opened >= dateRange.from && opened <= dateRange.to;
  });

  const openCount = dateFilteredOrders.filter(o => o.status.toLowerCase() === 'open').length;
  const closedCount = dateFilteredOrders.filter(o => o.status.toLowerCase() === 'closed').length;

  const uniqueSources = Array.from(new Set(orders.map(o => o.broker).filter((b): b is string => !!b))).sort();

  const filteredOrders = dateFilteredOrders.filter(o => {
    if (statusFilter === 'open') return o.status.toLowerCase() === 'open';
    if (statusFilter === 'closed') return o.status.toLowerCase() === 'closed';
    return true;
  }).filter(o => matchesSourceFilter(o.broker, sourceFilter))
    .filter(o => matchesSymbolFilter(o.symbol, nameFilter));

  // For the unrealized card: always open trades, but respects date / source / symbol filters
  const openFilteredOrders = dateFilteredOrders
    .filter(o => o.status.toLowerCase() === 'open')
    .filter(o => matchesSourceFilter(o.broker, sourceFilter))
    .filter(o => matchesSymbolFilter(o.symbol, nameFilter));

  function applyCustom() {
    if (customFrom && customTo) {
      setDateFilter('custom');
    }
  }

  return (
    <article className="panel">
      <div className="table-header">
        <div>
          <div className="trades-title-row">
            <h2>Trade History</h2>
            <button
              type="button"
              role="switch"
              aria-checked={autoReload}
              className={`ios-toggle${autoReload ? ' ios-toggle--on' : ''}`}
              onClick={() => setAutoReload(v => !v)}
              aria-label="Auto-refresh every 30 seconds"
            >
              <span className="ios-toggle__track">
                <span className="ios-toggle__thumb" />
              </span>
              {autoReload && <span className="ios-toggle__countdown">{countdown}s</span>}
            </button>
            {onToggleChat && (
              <button
                type="button"
                className={`trades-chat-btn${chatOpen ? ' trades-chat-btn--active' : ''}`}
                onClick={onToggleChat}
                aria-label="Toggle AI assistant"
              >
                🤖
              </button>
            )}
          </div>
          <p>{orders.length === 0 ? 'No manual trades yet.' : 'Manual positions stored in the app.'}</p>
        </div>
        <TableActions onAddTrade={onAddTrade} onAddMultiple={onAddMultiple} />
      </div>

      {orders.length > 0 && (
        <div className="tt-summary-bar">
          <TotalUnrealPnlCard orders={openFilteredOrders} livePrices={livePrices} />
          <TotalPnlCard orders={filteredOrders} />
        </div>
      )}

      {orders.length > 0 && (
        <div className="trades-filter-bar">
          {/* 1. Symbol search */}
          <div className="trades-filter-field">
            <label className="trades-filter-label">Symbol</label>
            <div className="trades-name-search">
              <input
                type="text"
                className="trades-filter-input"
                placeholder="Search…"
                value={nameFilter}
                onChange={e => setNameFilter(e.target.value)}
              />
              {nameFilter && (
                <button className="trades-input-clear" onClick={() => setNameFilter('')} aria-label="Clear">✕</button>
              )}
            </div>
          </div>

          {/* 2. Status select */}
          <div className="trades-filter-field">
            <label className="trades-filter-label">Status</label>
            <select
              className="trades-filter-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All ({dateFilteredOrders.length})</option>
              <option value="open">Open ({openCount})</option>
              <option value="closed">Closed ({closedCount})</option>
            </select>
          </div>

          {/* 3. Source multi-select dropdown */}
          {uniqueSources.length > 0 && (
            <div className="trades-filter-field">
              <label className="trades-filter-label">Source</label>
              <div className="trades-source-dropdown" ref={sourceDropdownRef}>
                <button
                  className={`trades-filter-select trades-filter-select--btn${sourceFilter.size > 0 ? ' trades-filter-select--active' : ''}`}
                  onClick={() => setShowSourceDropdown(v => !v)}
                  type="button"
                >
                  <span>{sourceFilter.size === 0 ? 'All' : Array.from(sourceFilter).join(', ')}</span>
                  <span className="trades-select-caret">▾</span>
                </button>
                {showSourceDropdown && (
                  <div className="trades-source-menu">
                    {uniqueSources.map(source => (
                      <label key={source} className="trades-source-option">
                        <input
                          type="checkbox"
                          checked={sourceFilter.has(source)}
                          onChange={() => {
                            setSourceFilter(prev => {
                              const next = new Set(prev);
                              next.has(source) ? next.delete(source) : next.add(source);
                              return next;
                            });
                          }}
                        />
                        {source}
                      </label>
                    ))}
                    {sourceFilter.size > 0 && (
                      <button
                        className="trades-source-clear"
                        onClick={() => { setSourceFilter(new Set()); setShowSourceDropdown(false); }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. Date select */}
          <div className="trades-filter-field">
            <label className="trades-filter-label">Date</label>
            <div className="trades-date-custom-wrap">
              <select
                className="trades-filter-select"
                value={dateFilter ?? ''}
                onChange={e => {
                  const val = e.target.value as DateFilter | '';
                  if (val === '') { setDateFilter(null); setCustomFrom(''); setCustomTo(''); }
                  else { setDateFilter(val as DateFilter); }
                }}
              >
                <option value="">All time</option>
                <option value="today">Today</option>
                <option value="7D">Last 7 days</option>
                <option value="30D">Last 30 days</option>
                <option value="custom">{dateFilter === 'custom' && customFrom && customTo ? `${customFrom} – ${customTo}` : 'Custom…'}</option>
              </select>
              {dateFilter === 'custom' && (
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
          </div>
          {/* 5. Reset filters */}
          <div className="trades-filter-field trades-filter-field--reset">
            <label className="trades-filter-label">&nbsp;</label>
            <button
              type="button"
              className="btn btn--secondary trades-filter-reset"
              onClick={resetFilters}
            >
              Reset
            </button>
          </div>
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
                <th>Unreal P/L</th>
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

                    {/* UNREALIZED P/L */}
                    <td data-label="Unreal P/L">
                      {isOpen
                        ? (() => {
                            const livePrice = livePrices[order.symbol.toUpperCase()];
                            if (livePrice == null) return <span className="tt-muted tt-live-loading">…</span>;
                            const upnl = calcUnrealizedPnl(order.entryPrice, livePrice, order.quantity, order.side);
                            const pct = upnl != null && order.quantity != null
                              ? upnl / (order.entryPrice * order.quantity) * 100
                              : null;
                            return (
                              <div className="tt-pnl-stack">
                                <PnlCell pnl={upnl} />
                                {pct != null && (
                                  <span className={`tt-pnl-pct ${pct >= 0 ? 'tt-pnl-positive' : 'tt-pnl-negative'}`}>
                                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                                  </span>
                                )}
                              </div>
                            );
                          })()
                        : <PnlCell pnl={order.pnl} />
                      }
                    </td>

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
                          className="tt-btn tt-btn--notes"
                          data-tooltip="View Notes"
                          aria-label="View Notes"
                          onClick={() => onViewNotes(order)}
                        >
                          <IconNotes />
                        </button>
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
