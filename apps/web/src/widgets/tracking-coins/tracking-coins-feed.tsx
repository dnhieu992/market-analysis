'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { resolveApiBaseUrl, createApiClient } from '@web/shared/api/client';
import type { TrackingCoinRow, TrackingCoinScore, TrackingPriceChange } from '@web/shared/api/types';
import { SetupChartDialog, SWING_CHART_TIMEFRAMES } from '@web/widgets/bitget/setup-chart-dialog';

import { CoinPanel } from './coin-panel';
import { TradesTab } from './trades-tab';
import styles from './tracking.module.css';

type Props = { initialCoins: TrackingCoinRow[] };

/** Columns the table can order by. `null` sort = the watchlist's own order (the default). */
type SortCol = 'coin' | 'score' | 'price' | 'chg24h' | 'chg7d' | 'chg30d' | 'chg90d' | 'chg180d';
type Sort = { col: SortCol; dir: 'desc' | 'asc' };

const PAGE_SIZE = 50;
const ACTIVE_REFRESH_MS = 30_000;

type ActiveSetups = Record<string, Array<{ id: string; status: string; direction: string }>>;

const ACTIVE_LABEL: Record<string, string> = { PROPOSED: 'đề xuất', WATCHING: 'theo dõi', PENDING: 'chờ khớp', OPEN: 'mở' };

/** Badge counts per stage for a coin's live setups — the "Setup" column. */
function ActiveCell({ items }: { items: ActiveSetups[string] | undefined }) {
  if (!items?.length) return <span className="scr-muted">—</span>;
  const by = new Map<string, number>();
  for (const x of items) by.set(x.status, (by.get(x.status) ?? 0) + 1);
  return (
    <span className={styles.badges}>
      {['OPEN', 'PENDING', 'WATCHING', 'PROPOSED'].filter((k) => by.has(k)).map((k) => (
        <span key={k} className={`${styles.badge} ${styles[`st${k}`] ?? ''}`} title={items.filter((x) => x.status === k).map((x) => x.direction).join(', ')}>
          {by.get(k)} {ACTIVE_LABEL[k]}
        </span>
      ))}
    </span>
  );
}
const PRICE_REFRESH_MS = 5000;
/** 7d / 30d / 90d / 180d only move on a daily close — poll them rarely. */
const CHANGE_REFRESH_MS = 5 * 60_000;
/** Scores read closed daily candles, so they move once a day. Same slow cadence. */
const SCORE_REFRESH_MS = 5 * 60_000;

/** Human label per rule id — the Scores tooltip explains where the point came from. */
const RULE_LABELS: Record<string, string> = {
  supertrendD1: 'Supertrend(10,3) D1 bullish',
};

/* ── live price hook ────────────────────────────────────────────── */

type PriceMap = Map<string, number>;
type PriceFlash = Map<string, 'up' | 'down'>;
/** Rolling 24h change as a ratio (0.0123 = +1.23%), keyed by bare symbol. */
type ChangeMap = Map<string, number>;

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1)    return price.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

/**
 * Live price + rolling 24h change from Binance's 24hr ticker. One request serves
 * both columns, and the 24h reading is the exchange's own rolling window — the
 * same thing the Bitget Setup tab shows — not "change since yesterday's close".
 */
function useLivePrices(symbols: string[]) {
  const [prices, setPrices] = useState<PriceMap>(new Map());
  const [changes24h, setChanges24h] = useState<ChangeMap>(new Map());
  const [flash, setFlash]   = useState<PriceFlash>(new Map());
  const prevRef = useRef<PriceMap>(new Map());

  const fetchPrices = useCallback(async () => {
    if (symbols.length === 0) return;
    const usdtSymbols = symbols.map(s => `${s}USDT`);
    const query = encodeURIComponent(JSON.stringify(usdtSymbols));
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${query}`);
      if (!res.ok) return;
      const data = await res.json() as { symbol: string; lastPrice: string; priceChangePercent: string }[];
      const next: PriceMap = new Map();
      const nextChanges: ChangeMap = new Map();
      const nextFlash: PriceFlash = new Map();
      for (const { symbol, lastPrice, priceChangePercent } of data) {
        const coin = symbol.replace(/USDT$/, '');
        const val = parseFloat(lastPrice);
        next.set(coin, val);
        const pct = parseFloat(priceChangePercent);
        if (Number.isFinite(pct)) nextChanges.set(coin, pct / 100);
        const prev = prevRef.current.get(coin);
        if (prev !== undefined && prev !== val) {
          nextFlash.set(coin, val > prev ? 'up' : 'down');
        }
      }
      prevRef.current = next;
      setPrices(next);
      setChanges24h(nextChanges);
      setFlash(nextFlash);
      // clear flash after 600ms
      if (nextFlash.size > 0) {
        setTimeout(() => setFlash(new Map()), 600);
      }
    } catch { /* ignore */ }
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchPrices]);

  return { prices, changes24h, flash };
}

/* ── change columns (24h / 7d / 90d) ────────────────────────────── */

/** Change ratio (0.0123) → signed percent string, same format as the Bitget Setup tab. */
function fmtChange(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Up/down colour class for a change ratio (empty when missing / flat). */
function chgClass(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '';
  return ratio > 0 ? 'bg-chg--up' : ratio < 0 ? 'bg-chg--down' : '';
}

/* ── Scores cell ────────────────────────────────────────────────── */

/**
 * `passed/total` over the scoring rules — `1/1` when the coin's D1 Supertrend is
 * bullish. Full marks read green, anything less reads muted, and hovering lists
 * each rule so the number is never a mystery.
 */
function ScoreCell({ score }: { score: TrackingCoinScore | undefined }) {
  if (!score || score.score === null) return <span className="scr-muted">—</span>;

  const full = score.score === score.maxScore;
  const title = Object.entries(score.rules)
    .map(([id, passed]) => {
      const mark = passed === null ? '–' : passed ? '✓' : '✕';
      return `${mark} ${RULE_LABELS[id] ?? id}`;
    })
    .join('\n');

  return (
    <span className={`tc-score${full ? ' tc-score--full' : ''}`} title={title}>
      {score.score}/{score.maxScore}
    </span>
  );
}

/**
 * A sortable column header — cycles desc → asc → off. "Off" returns the table to
 * the watchlist's own order, which is where it starts: no column sorts by default.
 */
function SortHeader({ label, col, sort, onSort, title }: {
  label: string;
  col: SortCol;
  sort: Sort | null;
  onSort: (col: SortCol) => void;
  title: string;
}) {
  const dir = sort?.col === col ? sort.dir : null;
  return (
    <th
      className="scr-th scr-th--num bg-th-sort"
      aria-sort={dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : 'none'}
    >
      <button type="button" className="bg-th-sort-btn" onClick={() => onSort(col)} title={title}>
        {label}
        <span className="bg-th-sort-ind">{dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '↕'}</span>
      </button>
    </th>
  );
}

/* ── icons ──────────────────────────────────────────────────────── */

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function IconChart() {
  // Candlestick glyph — opens the same server-rendered chart the /bitget page uses.
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="3" x2="8" y2="21" />
      <rect x="5" y="7" width="6" height="9" rx="1" />
      <line x1="17" y1="3" x2="17" y2="21" />
      <rect x="14" y="10" width="6" height="7" rx="1" />
    </svg>
  );
}

/* ── confirm remove dialog ──────────────────────────────────────── */

function ConfirmRemoveDialog({ symbol, isRemoving, onConfirm, onCancel }: {
  symbol: string; isRemoving: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Xóa coin</span>
          <button className="dialog-close" onClick={onCancel}>✕</button>
        </div>
        <div className="dialog-body">
          <p className="dialog-confirm-text">Xóa <strong>{symbol}</strong> khỏi danh sách theo dõi?</p>
          <div className="dialog-confirm-actions">
            <button className="btn btn--secondary" onClick={onCancel} disabled={isRemoving}>Hủy</button>
            <button className="btn btn--danger" onClick={onConfirm} disabled={isRemoving}>
              {isRemoving ? 'Đang xóa…' : 'Xóa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── add coin form ──────────────────────────────────────────────── */

function AddCoinForm({ onAdded }: { onAdded: (coin: TrackingCoinRow) => void }) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/tracking-coins/coins`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, name: name.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { id: string; symbol: string; name: string };
      onAdded({ ...data, marketCap: null, addedAt: new Date().toISOString() });
      setSymbol('');
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thêm coin thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="scr-add-form" onSubmit={handleSubmit}>
      <input className="scr-add-input" placeholder="Symbol (e.g. BTC, ETH)" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
      <input className="scr-add-input scr-add-input--name" placeholder="Tên coin (tuỳ chọn)" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="scr-add-btn" type="submit" disabled={loading}>{loading ? '...' : '+ Thêm'}</button>
      {error && <span className="scr-scan-result" style={{ color: 'var(--color-red, #ef4444)' }}>{error}</span>}
    </form>
  );
}

/* ── main feed ──────────────────────────────────────────────────── */

export function TrackingCoinsFeed({ initialCoins }: Props) {
  const [coins, setCoins] = useState<TrackingCoinRow[]>(initialCoins);
  const symbols = useMemo(() => coins.map(c => c.symbol), [coins]);
  const { prices, changes24h, flash } = useLivePrices(symbols);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  // No column sorts on load — rows keep the watchlist order until a header is clicked.
  const [sort, setSort] = useState<Sort | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [view, setView] = useState<'coins' | 'trades'>('coins');
  // Coin panel: a symbol, '*' = scan the whole watchlist, null = closed.
  const [panel, setPanel] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveSetups>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [confirmRemoveSymbol, setConfirmRemoveSymbol] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  // 7d / 30d / 90d change per bare symbol, from the API (Binance daily closes).
  const [changes, setChanges] = useState<Record<string, Omit<TrackingPriceChange, 'symbol'>>>({});
  // Rule score per bare symbol — the "Scores" column.
  const [scores, setScores] = useState<Record<string, TrackingCoinScore>>({});

  useEffect(() => { setPage(1); }, [nameFilter, sort]);

  const loadActive = useCallback(async () => {
    try {
      setActive(await createApiClient().fetchTrackingActiveByCoin());
    } catch { /* non-fatal: the Setup column keeps its last-known values */ }
  }, []);

  useEffect(() => {
    void loadActive();
    const id = setInterval(() => void loadActive(), ACTIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadActive]);

  const onSetupsChanged = useCallback(() => {
    void loadActive();
    setReloadKey((k) => k + 1);
  }, [loadActive]);

  const activeTotal = useMemo(() => Object.values(active).reduce((a, x) => a + x.length, 0), [active]);

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await createApiClient().fetchTrackingPriceChanges(symbols);
        if (cancelled) return;
        setChanges((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            const { symbol, ...rest } = r;
            next[symbol] = rest;
          }
          return next;
        });
      } catch { /* non-fatal: the change columns keep their last-known values */ }
    };
    void load();
    const id = setInterval(() => void load(), CHANGE_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbols]);

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await createApiClient().fetchTrackingScores(symbols);
        if (cancelled) return;
        setScores((prev) => {
          const next = { ...prev };
          for (const r of rows) next[r.symbol] = r;
          return next;
        });
      } catch { /* non-fatal: the Scores column keeps its last-known values */ }
    };
    void load();
    const id = setInterval(() => void load(), SCORE_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbols]);

  async function handleRemoveCoin(symbol: string) {
    setRemovingSymbol(symbol);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/tracking-coins/coins/${encodeURIComponent(symbol)}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) setCoins((prev) => prev.filter((c) => c.symbol !== symbol));
      else setStatusMsg(`Xóa ${symbol} thất bại.`);
    } catch {
      setStatusMsg(`Xóa ${symbol} thất bại.`);
    } finally {
      setRemovingSymbol(null);
    }
  }

  /**
   * Cycle a column's sort: desc → asc → off. "Off" drops back to the watchlist
   * order rather than another column, and clicking a different header starts
   * fresh at desc, so only one column ever sorts at a time.
   */
  const cycleSort = useCallback((col: SortCol) => {
    // Names read best A→Z first, changes best-performer first.
    const first: 'asc' | 'desc' = col === 'coin' ? 'asc' : 'desc';
    const second: 'asc' | 'desc' = first === 'asc' ? 'desc' : 'asc';
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: first };
      return prev.dir === first ? { col, dir: second } : null;
    });
  }, []);

  /** Numeric sort value for a price/change column — null sinks the row to the bottom. */
  const numericValue = useCallback(
    (symbol: string, col: SortCol): number | null => {
      const v =
        col === 'score'  ? scores[symbol]?.score :
        col === 'price'  ? prices.get(symbol) :
        col === 'chg24h' ? changes24h.get(symbol) :
        col === 'chg7d'  ? changes[symbol]?.change7d :
        col === 'chg30d' ? changes[symbol]?.change30d :
        col === 'chg90d' ? changes[symbol]?.change90d :
                           changes[symbol]?.change180d;
      return v == null || !Number.isFinite(v) ? null : v;
    },
    [scores, prices, changes24h, changes],
  );

  // Name/symbol search is the only filter left (2026-07-26 — the zone / quality /
  // trend / holding chips were dropped with the signal refactor).
  const sorted = useMemo(() => {
    const q = nameFilter.trim().toUpperCase();
    const filtered = coins.filter((c) => !q || c.symbol.includes(q) || c.name.toUpperCase().includes(q));
    if (!sort) return filtered;
    if (sort.col === 'coin') {
      return [...filtered].sort((a, b) =>
        sort.dir === 'asc' ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol));
    }
    const miss = sort.dir === 'desc' ? -Infinity : Infinity;
    return [...filtered].sort((a, b) => {
      const va = numericValue(a.symbol, sort.col) ?? miss;
      const vb = numericValue(b.symbol, sort.col) ?? miss;
      return sort.dir === 'desc' ? vb - va : va - vb;
    });
  }, [coins, nameFilter, sort, numericValue]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      {panel && (
        <CoinPanel
          key={panel}
          symbol={panel === '*' ? null : panel}
          symbols={symbols}
          onClose={() => setPanel(null)}
          onChanged={onSetupsChanged}
        />
      )}
      {confirmRemoveSymbol && (
        <ConfirmRemoveDialog
          symbol={confirmRemoveSymbol}
          isRemoving={removingSymbol === confirmRemoveSymbol}
          onConfirm={async () => { await handleRemoveCoin(confirmRemoveSymbol); setConfirmRemoveSymbol(null); }}
          onCancel={() => setConfirmRemoveSymbol(null)}
        />
      )}
      {chartSymbol && (
        <SetupChartDialog
          symbol={chartSymbol}
          tf="4h"
          timeframes={SWING_CHART_TIMEFRAMES}
          onClose={() => setChartSymbol(null)}
        />
      )}

      <main className="dashboard-shell scr-shell">
        {/* header */}
        <div className="tc-page-header">
          <div className="tc-page-title-row">
            <h1 className="scr-title">Tracking Coins</h1>
          </div>
          <div className="scr-toolbar-right">
            <button className="scr-add-toggle" onClick={() => setPanel('*')} title="Claude quét cả danh sách và đề xuất setup">
              🧭 Quét
            </button>
            {view === 'coins' && (
              <button className="scr-add-toggle" onClick={() => setShowAddForm((v) => !v)}>
                {showAddForm ? '✕' : '+ Coin'}
              </button>
            )}
          </div>
        </div>

        <div className={styles.tabs}>
          <button type="button" className={`${styles.tab} ${view === 'coins' ? styles.tabActive : ''}`} onClick={() => setView('coins')}>
            Coins<span className={styles.count}>{coins.length}</span>
          </button>
          <button type="button" className={`${styles.tab} ${view === 'trades' ? styles.tabActive : ''}`} onClick={() => setView('trades')}>
            Lệnh &amp; nhật ký{activeTotal > 0 && <span className={styles.count}>{activeTotal}</span>}
          </button>
        </div>

        {view === 'trades' && (
          <TradesTab symbols={symbols} onOpenCoin={setPanel} onScan={() => setPanel('*')} reloadKey={reloadKey} onChanged={onSetupsChanged} />
        )}

        {view === 'coins' && (<>

        {statusMsg && <p className="scr-scan-result">{statusMsg}</p>}

        {showAddForm && view === 'coins' && (
          <AddCoinForm
            onAdded={(coin) => {
              setCoins((prev) => prev.some((c) => c.symbol === coin.symbol) ? prev : [...prev, coin]);
              setShowAddForm(false);
            }}
          />
        )}

        {/* filters */}
        <div className="tc-filters">
          <input
            className="scr-search tc-filter-search"
            type="search"
            placeholder="Tìm symbol / tên…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
        </div>

        {/* table */}
        <div className="scr-table-wrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th className="scr-th scr-th--coin bg-th-sort" aria-sort={sort?.col === 'coin' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="bg-th-sort-btn" onClick={() => cycleSort('coin')} title="Sắp xếp theo tên coin">
                    Coin
                    <span className="bg-th-sort-ind">
                      {sort?.col === 'coin' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
                <SortHeader label="Scores" col="score" sort={sort} onSort={cycleSort} title="Số tiêu chí coin đang thoả / tổng số tiêu chí. Hiện chỉ có 1: Supertrend(10,3) D1 bullish (nến D1 đã đóng)." />
                <SortHeader label="Giá"   col="price"  sort={sort} onSort={cycleSort} title="Giá hiện tại (Binance, cập nhật mỗi 5 giây)" />
                <SortHeader label="24h %" col="chg24h" sort={sort} onSort={cycleSort} title="Thay đổi 24 giờ (rolling, ticker Binance)" />
                <SortHeader label="7d %"  col="chg7d"  sort={sort} onSort={cycleSort} title="Thay đổi 7 ngày (so với close 7 nến D1 trước)" />
                <SortHeader label="30d %" col="chg30d" sort={sort} onSort={cycleSort} title="Thay đổi 30 ngày (so với close 30 nến D1 trước)" />
                <SortHeader label="90d %" col="chg90d" sort={sort} onSort={cycleSort} title="Thay đổi 90 ngày (so với close 90 nến D1 trước)" />
                <SortHeader label="180d %" col="chg180d" sort={sort} onSort={cycleSort} title="Thay đổi 180 ngày (so với close 180 nến D1 trước)" />
                <th className="scr-th scr-th--num" title="Setup swing đang chạy (đề xuất / theo dõi / chờ khớp / mở)">Setup</th>
                <th className="scr-th scr-th--num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="scr-empty">
                    {coins.length === 0
                      ? 'Chưa có coin nào. Nhấn "+ Coin" để thêm.'
                      : nameFilter
                      ? `Không tìm thấy coin khớp với "${nameFilter}".`
                      : 'Không có coin nào khớp filter.'}
                  </td>
                </tr>
              )}
              {paginated.map((coin) => {
                const price = prices.get(coin.symbol);
                const chg24h = changes24h.get(coin.symbol) ?? null;
                const chg = changes[coin.symbol];
                return (
                  <tr key={coin.id} className="scr-row" onClick={() => setPanel(coin.symbol)} style={{ cursor: 'pointer' }} title="Mở panel phân tích / lệnh / nhật ký">
                    <td className="scr-td scr-td--coin">
                      <span className="tc-coin-line">
                        <span className="scr-symbol">{coin.symbol}</span>
                        <button
                          className="tc-chart-btn"
                          aria-label={`Xem chart ${coin.symbol}`}
                          title="Xem chart (SonicR + S/R + RSI)"
                          onClick={(e) => { e.stopPropagation(); setChartSymbol(coin.symbol); }}
                        >
                          <IconChart />
                        </button>
                      </span>
                    </td>
                    <td className="scr-td scr-td--num tc-td--score">
                      <ScoreCell score={scores[coin.symbol]} />
                    </td>
                    {/* Live price — its own column since 2026-08-11 (was stacked under the ticker). */}
                    <td className="scr-td scr-td--num tc-td--price">
                      {price != null
                        ? <span className={`tc-live-price tc-live-price--${flash.get(coin.symbol) ?? 'idle'}`}>
                            ${formatPrice(price)}
                          </span>
                        : <span className="scr-muted">—</span>}
                    </td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg24h)}`}>{fmtChange(chg24h)}</td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg?.change7d)}`}>{fmtChange(chg?.change7d)}</td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg?.change30d)}`}>{fmtChange(chg?.change30d)}</td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg?.change90d)}`}>{fmtChange(chg?.change90d)}</td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg?.change180d)}`}>{fmtChange(chg?.change180d)}</td>
                    <td className="scr-td scr-td--num"><ActiveCell items={active[coin.symbol]} /></td>
                    <td className="scr-td scr-td--num" onClick={(e) => e.stopPropagation()}>
                      <div className="tt-actions">
                        <button className="tt-btn tt-btn--danger" data-tooltip="Xóa" aria-label={`Xóa ${coin.symbol}`} onClick={() => setConfirmRemoveSymbol(coin.symbol)} disabled={removingSymbol === coin.symbol}>
                          {removingSymbol === coin.symbol ? '…' : <IconTrash />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {totalPages > 1 && (
          <div className="scr-pagination">
            <button className="scr-page-btn" onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
            <button className="scr-page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>‹</button>
            <span className="scr-page-info">
              Trang {safePage} / {totalPages}
              <span className="scr-page-sub">&nbsp;({(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} / {sorted.length})</span>
            </span>
            <button className="scr-page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>›</button>
            <button className="scr-page-btn" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</button>
          </div>
        )}
        </>)}
      </main>
    </>
  );
}
