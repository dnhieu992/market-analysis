'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createApiClient } from '@web/shared/api/client';
import type { DashboardOrder } from '@web/shared/api/types';

export function calcUnrealizedPnl(
  openOrders: DashboardOrder[],
  pricesMap: Record<string, number>,
): number {
  if (!openOrders || openOrders.length === 0) return 0;
  return openOrders.reduce((sum, order) => {
    const currentPrice = pricesMap[order.symbol];
    if (currentPrice == null) return sum;
    if (order.quantity == null) return sum;
    const diff = order.side.toLowerCase() === 'short'
      ? order.entryPrice - currentPrice
      : currentPrice - order.entryPrice;
    return sum + diff * order.quantity;
  }, 0);
}

export function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '...')[] = [1];
  if (current > 3) pages.push('...');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

type TradesTableProps = Readonly<{
  orders: DashboardOrder[];
  total: number;
  page: number;
  pageSize: number;
  closedPnlSum: number;
  openOrders: DashboardOrder[];
  availableBrokers: string[];
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
      <img src={url} alt="screenshot" className="lightbox-img" onClick={(e) => e.stopPropagation()} />
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
                      <img src={url} alt="trade screenshot" onClick={() => setLightboxUrl(url)} />
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
  if (normalized === 'open') return <span className="tt-status-pill tt-status-pill--opening">Opening</span>;
  if (normalized === 'closed') return <span className="tt-status-pill tt-status-pill--closed">Closed</span>;
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

function TotalPnlCard({ closedPnlSum }: { closedPnlSum: number }) {
  const isPositive = closedPnlSum >= 0;
  return (
    <div className="tt-pnl-card">
      <span className="tt-pnl-card__label">Total Profit/Loss</span>
      <span className={`tt-pnl-card__value ${isPositive ? 'tt-pnl-card__value--positive' : 'tt-pnl-card__value--negative'}`}>
        {isPositive ? '+' : ''}{formatVolume(closedPnlSum)}
      </span>
      <span className="tt-pnl-card__note">Closed trades in selected period</span>
    </div>
  );
}

function TotalUnrealPnlCard({ openOrders, livePrices }: { openOrders: DashboardOrder[]; livePrices: Record<string, number> }) {
  const allPricesLoaded = openOrders.length > 0 && openOrders.every(o => livePrices[o.symbol.toUpperCase()] != null);
  const normalizedPricesMap: Record<string, number> = {};
  for (const [k, v] of Object.entries(livePrices)) normalizedPricesMap[k.toUpperCase()] = v;
  const normalizedOrders = openOrders.map(o => ({ ...o, symbol: o.symbol.toUpperCase() }));
  const total = calcUnrealizedPnl(normalizedOrders, normalizedPricesMap);
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

function Pagination({ page, pageSize, total, onPageChange }: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const pages = getPageNumbers(page, totalPages);

  return (
    <div className="tt-pagination">
      <button
        className="tt-pagination__btn"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        ← Prev
      </button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="tt-pagination__ellipsis">…</span>
        ) : (
          <button
            key={p}
            className={`tt-pagination__btn${p === page ? ' tt-pagination__btn--active' : ''}`}
            onClick={() => onPageChange(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}
      <button
        className="tt-pagination__btn"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        Next →
      </button>
    </div>
  );
}

export function TradesTable({
  orders, total, page, pageSize, closedPnlSum, openOrders, availableBrokers,
  onAddTrade, onAddMultiple, onCloseTrade, onEditTrade, onRemoveTrade, onViewNotes,
  chatOpen, onToggleChat,
}: TradesTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams()!;
  const [autoReload, setAutoReload] = useState(false);
  const [countdown, setCountdown] = useState(5);

  // Symbol: local draft to avoid re-fetching on every keystroke
  const [symbolDraft, setSymbolDraft] = useState(searchParams.get('symbol') ?? '');
  useEffect(() => {
    setSymbolDraft(searchParams.get('symbol') ?? '');
  }, [searchParams]);

  // Debounce symbol push to URL (400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (symbolDraft) params.set('symbol', symbolDraft);
      else params.delete('symbol');
      params.delete('page');
      router.push(`/trades?${params.toString()}`);
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolDraft]);

  const statusFilter = searchParams.get('status') ?? 'all';
  const brokerFilter = searchParams.get('broker') ?? '';
  const dateFilter = searchParams.get('dateFilter') ?? '';
  const customFrom = searchParams.get('dateFrom') ?? '';
  const customTo = searchParams.get('dateTo') ?? '';

  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showDatePopover, setShowDatePopover] = useState(false);
  const [localCustomFrom, setLocalCustomFrom] = useState(customFrom);
  const [localCustomTo, setLocalCustomTo] = useState(customTo);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node)) {
        setShowSourceDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!autoReload) { setCountdown(5); return; }
    setCountdown(5);
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { router.refresh(); return 5; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [autoReload, router]);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    router.push(`/trades?${params.toString()}`);
  }

  function handleStatusChange(val: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (val === 'all') params.delete('status');
    else params.set('status', val);
    params.delete('page');
    router.push(`/trades?${params.toString()}`);
  }

  function handleBrokerToggle(broker: string) {
    const current = brokerFilter ? brokerFilter.split(',') : [];
    const next = current.includes(broker)
      ? current.filter(b => b !== broker)
      : [...current, broker];
    updateParam('broker', next.join(','));
  }

  function handleDatePreset(preset: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('dateFrom');
    params.delete('dateTo');
    params.delete('page');
    if (preset) params.set('dateFilter', preset);
    else params.delete('dateFilter');

    const now = new Date();
    if (preset === 'today') {
      params.set('dateFrom', now.toISOString().slice(0, 10));
      params.set('dateTo', now.toISOString().slice(0, 10));
    } else if (preset === '7D') {
      const from = new Date(now); from.setDate(from.getDate() - 7);
      params.set('dateFrom', from.toISOString().slice(0, 10));
      params.set('dateTo', now.toISOString().slice(0, 10));
    } else if (preset === '30D') {
      const from = new Date(now); from.setDate(from.getDate() - 30);
      params.set('dateFrom', from.toISOString().slice(0, 10));
      params.set('dateTo', now.toISOString().slice(0, 10));
    }
    router.push(`/trades?${params.toString()}`);
  }

  function applyCustomDate() {
    if (!localCustomFrom || !localCustomTo) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('dateFilter', 'custom');
    params.set('dateFrom', localCustomFrom);
    params.set('dateTo', localCustomTo);
    params.delete('page');
    router.push(`/trades?${params.toString()}`);
    setShowDatePopover(false);
  }

  function resetFilters() {
    router.push('/trades');
    setSymbolDraft('');
    setLocalCustomFrom('');
    setLocalCustomTo('');
  }

  function handlePageChange(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    router.push(`/trades?${params.toString()}`);
  }

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  useEffect(() => {
    const openSymbols = Array.from(new Set(openOrders.map(o => o.symbol.toUpperCase())));
    if (openSymbols.length === 0) return;
    const symbolsParam = encodeURIComponent(JSON.stringify(openSymbols));
    fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${symbolsParam}`)
      .then(r => r.json())
      .then((data: { symbol: string; price: string }[]) => {
        const map: Record<string, number> = {};
        for (const item of data) map[item.symbol] = Number(item.price);
        setLivePrices(map);
      })
      .catch(() => { /* silent */ });
  }, [openOrders]);

  const selectedBrokers = brokerFilter ? new Set(brokerFilter.split(',').filter(Boolean)) : new Set<string>();
  const totalPages = Math.ceil(total / pageSize);
  const hasOrders = total > 0 || orders.length > 0;

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
              aria-label="Auto-refresh every 5 seconds"
            >
              <span className="ios-toggle__track"><span className="ios-toggle__thumb" /></span>
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
          <p>{total === 0 ? 'No manual trades yet.' : `${total} trade${total !== 1 ? 's' : ''} found.`}</p>
        </div>
        <TableActions onAddTrade={onAddTrade} onAddMultiple={onAddMultiple} />
      </div>

      {hasOrders && (
        <div className="tt-summary-bar">
          <TotalUnrealPnlCard openOrders={openOrders} livePrices={livePrices} />
          <TotalPnlCard closedPnlSum={closedPnlSum} />
        </div>
      )}

      <div className="trades-filter-bar">
        {/* 1. Symbol search */}
        <div className="trades-filter-field">
          <label className="trades-filter-label">Symbol</label>
          <div className="trades-name-search">
            <input
              type="text"
              className="trades-filter-input"
              placeholder="Search…"
              value={symbolDraft}
              onChange={e => setSymbolDraft(e.target.value)}
            />
            {symbolDraft && (
              <button className="trades-input-clear" onClick={() => setSymbolDraft('')} aria-label="Clear">✕</button>
            )}
          </div>
        </div>

        {/* 2. Status select */}
        <div className="trades-filter-field">
          <label className="trades-filter-label">Status</label>
          <select
            className="trades-filter-select"
            value={statusFilter}
            onChange={e => handleStatusChange(e.target.value)}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        {/* 3. Source multi-select dropdown */}
        {availableBrokers.length > 0 && (
          <div className="trades-filter-field">
            <label className="trades-filter-label">Source</label>
            <div className="trades-source-dropdown" ref={sourceDropdownRef}>
              <button
                className={`trades-filter-select trades-filter-select--btn${selectedBrokers.size > 0 ? ' trades-filter-select--active' : ''}`}
                onClick={() => setShowSourceDropdown(v => !v)}
                type="button"
              >
                <span>{selectedBrokers.size === 0 ? 'All' : Array.from(selectedBrokers).join(', ')}</span>
                <span className="trades-select-caret">▾</span>
              </button>
              {showSourceDropdown && (
                <div className="trades-source-menu">
                  {availableBrokers.map(broker => (
                    <label key={broker} className="trades-source-option">
                      <input
                        type="checkbox"
                        checked={selectedBrokers.has(broker)}
                        onChange={() => handleBrokerToggle(broker)}
                      />
                      {broker}
                    </label>
                  ))}
                  {selectedBrokers.size > 0 && (
                    <button
                      className="trades-source-clear"
                      onClick={() => { updateParam('broker', ''); setShowSourceDropdown(false); }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. Date filter */}
        <div className="trades-filter-field">
          <label className="trades-filter-label">Date</label>
          <div className="trades-date-custom-wrap">
            <select
              className="trades-filter-select"
              value={dateFilter}
              onChange={e => {
                const val = e.target.value;
                if (val === 'custom') { setShowDatePopover(true); }
                else { handleDatePreset(val); setShowDatePopover(false); }
              }}
            >
              <option value="">All time</option>
              <option value="today">Today</option>
              <option value="7D">Last 7 days</option>
              <option value="30D">Last 30 days</option>
              <option value="custom">
                {dateFilter === 'custom' && customFrom && customTo ? `${customFrom} – ${customTo}` : 'Custom…'}
              </option>
            </select>
            {(dateFilter === 'custom' || showDatePopover) && (
              <div className="trades-date-popover">
                <label className="trades-date-popover__label">From</label>
                <input
                  type="date"
                  className="trades-date-popover__input"
                  value={localCustomFrom}
                  onChange={e => setLocalCustomFrom(e.target.value)}
                />
                <label className="trades-date-popover__label">To</label>
                <input
                  type="date"
                  className="trades-date-popover__input"
                  value={localCustomTo}
                  onChange={e => setLocalCustomTo(e.target.value)}
                />
                <button
                  className="btn btn--primary trades-date-popover__apply"
                  onClick={applyCustomDate}
                  disabled={!localCustomFrom || !localCustomTo}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 5. Reset */}
        <div className="trades-filter-field trades-filter-field--reset">
          <label className="trades-filter-label">&nbsp;</label>
          <button type="button" className="btn btn--secondary trades-filter-reset" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </div>

      {orders.length > 0 && (
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
              {orders.map((order) => {
                const isOpen = order.status.toLowerCase() === 'open';
                return (
                  <tr key={order.id}>
                    <td data-label="Name" data-full="">
                      <div className="tt-name">
                        <button className="tt-symbol-btn" onClick={() => onEditTrade(order)}>{order.symbol}</button>
                        <span className={`tt-side tt-side--${order.side.toLowerCase()}`}>{order.side.toUpperCase()}</span>
                      </div>
                    </td>
                    <td data-label="Open">
                      <div className="tt-price-date">
                        <span>Price: {formatPrice(order.entryPrice)}</span>
                        <span>Date: {formatDate(order.openedAt)}</span>
                      </div>
                    </td>
                    <td data-label="Close">
                      <div className="tt-price-date">
                        <span>Price: {order.closePrice != null ? formatPrice(order.closePrice) : '-'}</span>
                        <span>Date: {order.closedAt ? formatDate(order.closedAt) : '-'}</span>
                      </div>
                    </td>
                    <td data-label="Volume">{order.quantity != null ? formatVolume(order.quantity * order.entryPrice) : '-'}</td>
                    <td data-label="Source">{order.broker ?? '-'}</td>
                    <td data-label="Strategy">{order.exchange ?? '-'}</td>
                    <td data-label="Unreal P/L">
                      {isOpen
                        ? (() => {
                            const livePrice = livePrices[order.symbol.toUpperCase()];
                            if (livePrice == null) return <span className="tt-muted tt-live-loading">…</span>;
                            const upnl = order.quantity != null
                              ? (order.side.toLowerCase() === 'short'
                                  ? order.entryPrice - livePrice
                                  : livePrice - order.entryPrice) * order.quantity
                              : null;
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
                    <td data-label="P/L"><PnlCell pnl={order.pnl} /></td>
                    <td data-label="Order Type">{order.orderType ?? '-'}</td>
                    <td data-label="Status"><StatusPill status={order.status} /></td>
                    <td data-label="Actions" data-full="">
                      <div className="tt-actions">
                        {isOpen && (
                          <button className="tt-btn tt-btn--success" data-tooltip="Close Trade" aria-label="Close Trade" onClick={() => onCloseTrade(order)}>
                            <IconCircleCheck />
                          </button>
                        )}
                        <button className="tt-btn tt-btn--notes" data-tooltip="View Notes" aria-label="View Notes" onClick={() => onViewNotes(order)}>
                          <IconNotes />
                        </button>
                        <button className="tt-btn tt-btn--danger" data-tooltip="Delete" aria-label="Delete Trade" onClick={() => onRemoveTrade(order.id)}>
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

      {totalPages > 1 && (
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={handlePageChange} />
      )}
    </article>
  );
}
