'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type {
  BitgetHistoryResponse,
  BitgetPositionsResponse,
  BitgetSetupConfig,
  BitgetPriceChange,
  BitgetTradeChart,
} from '@web/shared/api/types';

import { useBitgetLivePrices } from '../bitget-positions/use-bitget-live-prices';
import {
  DEFAULT_CHART_TF,
  SetupChartDialog,
  tfLabelOf,
} from './setup-chart-dialog';
import { QqeCell, bareQqeSymbol as bareSymbol, type QqeMap } from './qqe-cell';
import { SymbolMultiSelect } from './symbol-multi-select';
import { BulkSetupDialog, type BulkSideInput } from './bulk-setup-dialog';
import { ChartNoteView } from './chart-note-dialog';

const REFRESH_MS = 15_000;
// QQE readings only change on candle close — poll on a slower cadence than positions.
const QQE_REFRESH_MS = 60_000;
// 7d / 30d change only moves once a day — poll rarely.
const CHANGE_REFRESH_MS = 5 * 60_000;

/** Which change column the table is sorted by (null = default pinned order). */
type SortCol = 'today' | 'd7' | 'd30';

// Always shown first, regardless of trade history.
const PINNED_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

// Coins to watch even before any trade has closed on them.
const WATCHLIST_SYMBOLS = [
  'SOLUSDT',
  'XRPUSDT',
  'SHIBUSDT',
  'PEPEUSDT',
  'WLDUSDT',
  'BCHUSDT',
  'AVAXUSDT',
  'AAVEUSDT',
  'FILUSDT',
  'ONDOUSDT',
  'TIAUSDT',
];

type ChartTarget = { symbol: string; tf: string };

type HoldSide = 'long' | 'short';

/** Per-coin, per-side config keyed by `${symbol}-${holdSide}`. */
type ConfigMap = Record<string, BitgetSetupConfig>;

const cfgKey = (symbol: string, holdSide: HoldSide) => `${symbol}-${holdSide}`;

function fmtUsdPlain(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Adaptive precision so both $60,000 BTC and $0.0000123 coins read cleanly. */
function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 24h change ratio (0.0123) → signed percent string. */
function fmtChange(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Up/down colour class for a change ratio (empty when missing / flat). */
function chgClass(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '';
  return ratio > 0 ? 'bg-chg--up' : ratio < 0 ? 'bg-chg--down' : '';
}

type Props = {
  history: BitgetHistoryResponse;
  positions: BitgetPositionsResponse;
  embedded?: boolean;
};

/**
 * Setup tab: one row per coin ever traded, with a separate LONG and SHORT
 * action cell. Each side carries its own manual-open config (leverage / margin,
 * always cross) persisted in the DB, its own ⚙ Setup dialog, and its own
 * open button. The Long/Short button stays enabled at all times: on a coin+side
 * that is already open it ADDS volume to that position (scale-in) at the live
 * position's leverage, and the API records the add-on in the trade's journal.
 */
export function BitgetSetupFeed({ history, positions: initialPositions, embedded = false }: Props) {
  const clientRef = useRef(createApiClient());
  const [positions, setPositions] = useState<BitgetPositionsResponse>(initialPositions);
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [editing, setEditing] = useState<{ symbol: string; holdSide: HoldSide } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [chartTarget, setChartTarget] = useState<ChartTarget | null>(null);
  const [refSymbol, setRefSymbol] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qqe, setQqe] = useState<QqeMap>({});
  // 7d/30d change per bare coin symbol (from Binance daily candles, via the API).
  const [priceChanges, setPriceChanges] = useState<Record<string, BitgetPriceChange>>({});
  // Change-column sort: null keeps the default pinned/watchlist order; clicking a
  // header cycles desc → asc → back to the default. Only one column sorts at a time.
  const [sort, setSort] = useState<{ col: SortCol; dir: 'desc' | 'asc' } | null>(null);
  // Coin-name filter (empty = all coins), same UX as the History tab.
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);

  // Hydrate saved configs from the DB (survives reloads, shared across devices).
  useEffect(() => {
    let alive = true;
    clientRef.current
      .fetchBitgetSetupConfigs()
      .then((list) => {
        if (!alive) return;
        const map: ConfigMap = {};
        for (const c of list) map[cfgKey(c.symbol, c.holdSide)] = c;
        setConfigs(map);
      })
      .catch(() => {
        /* non-fatal: rows just show as unconfigured until saved */
      });
    return () => {
      alive = false;
    };
  }, []);

  // BTC/ETH pinned first, then the watchlist, then every other coin ever traded
  // (newest-first by most recent close).
  const symbols = useMemo(() => {
    const lastClose = new Map<string, number>();
    for (const t of history.trades) {
      const ts = new Date(t.closedAt).getTime();
      const prev = lastClose.get(t.symbol) ?? 0;
      if (ts > prev) lastClose.set(t.symbol, ts);
    }
    const traded = [...lastClose.keys()].sort((a, b) => (lastClose.get(b) ?? 0) - (lastClose.get(a) ?? 0));
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const s of [...PINNED_SYMBOLS, ...WATCHLIST_SYMBOLS, ...traded]) {
      if (seen.has(s)) continue;
      seen.add(s);
      ordered.push(s);
    }
    return ordered;
  }, [history.trades]);

  // (symbol, side) pairs with a live open position on the exchange → Open disabled.
  const openSides = useMemo(
    () => new Set(positions.positions.map((p) => cfgKey(p.symbol, p.holdSide))),
    [positions.positions],
  );

  // Realtime last price + 24h change per coin, straight from Bitget's public WS.
  const { prices: livePrices, changes: liveChanges, live } = useBitgetLivePrices(symbols);

  // Change value for a coin on a given column — 24h from the live WS, 7d/30d from
  // the API. Returns null when the reading is missing (so it can sink in sorting).
  const changeValue = useCallback(
    (symbol: string, col: SortCol): number | null => {
      if (col === 'today') {
        const v = liveChanges[symbol];
        return v == null || !Number.isFinite(v) ? null : v;
      }
      const c = priceChanges[bareSymbol(symbol)];
      const v = col === 'd7' ? c?.change7d : c?.change30d;
      return v == null || !Number.isFinite(v) ? null : v;
    },
    [liveChanges, priceChanges],
  );

  // Rows follow the pinned/watchlist order by default; when a change header is
  // clicked they re-order by that column (coins without a reading sink last).
  const displaySymbols = useMemo(() => {
    const set = selectedSymbols.length > 0 ? new Set(selectedSymbols) : null;
    const base = set ? symbols.filter((s) => set.has(s)) : symbols;
    if (!sort) return base;
    const miss = sort.dir === 'desc' ? -Infinity : Infinity;
    return [...base].sort((a, b) => {
      const va = changeValue(a, sort.col) ?? miss;
      const vb = changeValue(b, sort.col) ?? miss;
      return sort.dir === 'desc' ? vb - va : va - vb;
    });
  }, [symbols, selectedSymbols, sort, changeValue]);

  // Cycle a column's sort: desc → asc → off. Clicking a different column starts
  // fresh at desc so only one column ever sorts at a time.
  const cycleSort = useCallback((col: SortCol) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'desc' };
      return prev.dir === 'desc' ? { col, dir: 'asc' } : null;
    });
  }, []);

  const refreshPositions = useCallback(async () => {
    try {
      const next = await clientRef.current.fetchBitgetPositions();
      setPositions(next);
    } catch {
      /* keep last-known positions; non-fatal for this tab */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refreshPositions, REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshPositions]);

  const refreshQqe = useCallback(async (syms: string[]) => {
    if (syms.length === 0) return;
    try {
      const rows = await clientRef.current.fetchBitgetQqeSignals(syms);
      setQqe((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.symbol] = r.signals;
        return next;
      });
    } catch {
      /* non-fatal: the QQE column just keeps its last-known (or empty) badges */
    }
  }, []);

  // Fetch QQE signals for the listed coins on mount / when the set changes, then
  // refresh on a slower cadence (readings only move on candle close).
  useEffect(() => {
    if (symbols.length === 0) return;
    void refreshQqe(symbols);
    const id = setInterval(() => void refreshQqe(symbols), QQE_REFRESH_MS);
    return () => clearInterval(id);
  }, [symbols, refreshQqe]);

  const refreshChanges = useCallback(async (syms: string[]) => {
    if (syms.length === 0) return;
    try {
      const rows = await clientRef.current.fetchBitgetPriceChanges(syms);
      setPriceChanges((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.symbol] = r;
        return next;
      });
    } catch {
      /* non-fatal: the 7d/30d columns just keep their last-known values */
    }
  }, []);

  // 7d/30d change refreshes rarely (it only moves once a day).
  useEffect(() => {
    if (symbols.length === 0) return;
    void refreshChanges(symbols);
    const id = setInterval(() => void refreshChanges(symbols), CHANGE_REFRESH_MS);
    return () => clearInterval(id);
  }, [symbols, refreshChanges]);

  const saveConfig = useCallback(
    async (symbol: string, holdSide: HoldSide, cfg: { leverage: number; marginUsd: number }) => {
      const next: BitgetSetupConfig = { symbol, holdSide, ...cfg };
      // Optimistic update so the row reflects the new config immediately.
      setConfigs((prev) => ({ ...prev, [cfgKey(symbol, holdSide)]: next }));
      setError(null);
      try {
        await clientRef.current.saveBitgetSetupConfig(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lưu cấu hình thất bại. Thử lại sau.');
      }
    },
    [],
  );

  /**
   * Bulk save: one leverage/margin written to every selected coin × side. The
   * server returns the saved rows, so the tab is refreshed from those rather
   * than from an optimistic guess about what got written.
   */
  const saveBulkConfig = useCallback(
    async (input: { symbols: string[]; sides: BulkSideInput[] }) => {
      setBulkSaving(true);
      setError(null);
      setNotice(null);
      try {
        const saved = await clientRef.current.saveBitgetSetupConfigsBulk(input);
        setConfigs((prev) => {
          const next = { ...prev };
          for (const c of saved) next[cfgKey(c.symbol, c.holdSide)] = c;
          return next;
        });
        setBulkOpen(false);
        setNotice(
          `Đã lưu ${saved.length} cấu hình cho ${input.symbols.length} coin: ` +
            input.sides
              .map((s) => `${s.holdSide.toUpperCase()} ${s.leverage}× · $${s.marginUsd}`)
              .join(' — ') +
            ' · cross.',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lưu cấu hình hàng loạt thất bại. Thử lại sau.');
      } finally {
        setBulkSaving(false);
      }
    },
    [],
  );

  const openPosition = useCallback(
    async (symbol: string, holdSide: HoldSide) => {
      const key = cfgKey(symbol, holdSide);
      const cfg = configs[key];
      if (!cfg || !(cfg.marginUsd > 0)) {
        setError(`Cấu hình ký quỹ cho ${symbol} (${holdSide.toUpperCase()}) trước khi mở lệnh.`);
        return;
      }
      // Already open on this coin+side → this click ADDS volume to that position
      // instead of opening a second one. Spell that out before it goes live.
      const isAdd = openSides.has(key);
      const confirmText = isAdd
        ? `${symbol} đang có vị thế ${holdSide.toUpperCase()} mở.\n` +
          `THÊM VOLUME vào lệnh đó theo giá market ngay bây giờ?\n` +
          `Ký quỹ thêm $${cfg.marginUsd} · đòn bẩy của vị thế đang mở · cross`
        : `Mở lệnh ${holdSide.toUpperCase()} ${symbol} theo giá market ngay bây giờ?\n` +
          `Ký quỹ $${cfg.marginUsd} · đòn bẩy ${cfg.leverage}× · cross`;
      if (!window.confirm(confirmText)) return;

      setOpeningKey(key);
      setError(null);
      setNotice(null);
      try {
        const res = await clientRef.current.openBitgetPosition({
          symbol,
          holdSide,
          marginUsd: cfg.marginUsd,
          leverage: cfg.leverage,
        });
        setNotice(
          res.mode === 'add'
            ? `Đã thêm volume vào ${res.holdSide.toUpperCase()} ${symbol}: +${res.size} @ ~${res.entryPrice} ` +
              `(tổng size ${res.totalSize}, ${res.leverage}×). Đã ghi log vào nhật ký lệnh.`
            : `Đã mở ${res.holdSide.toUpperCase()} ${symbol}: size ${res.size} @ ~${res.entryPrice}.`,
        );
        await refreshPositions();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Mở lệnh thất bại. Thử lại sau.');
      } finally {
        setOpeningKey(null);
      }
    },
    [configs, openSides, refreshPositions],
  );

  const configured = history.configured || positions.configured;
  const sides: HoldSide[] = ['long', 'short'];

  return (
    <div className={embedded ? 'bg-panel' : 'page'}>
      <div className="bg-head">
        <div>
          {!embedded && <h1>Bitget · Setup mở lệnh</h1>}
          <p className="bg-sub">
            Mở lệnh nhanh theo giá market (cross) — mỗi coin có nút Long/Short riêng, cấu hình từng hướng được lưu lại.
          </p>
        </div>
        <div className="bg-head-actions">
          <span className={`bg-live ${live ? 'bg-live--on' : ''}`} title="Giá realtime từ Bitget WS">
            <span className="bg-live-dot" />
            {live ? 'Realtime' : 'Đang kết nối…'}
          </span>
          <button className="bg-refresh" onClick={refreshPositions}>
            ↻ Làm mới
          </button>
        </div>
      </div>

      {error && <div className="bg-alert bg-alert--error">{error}</div>}
      {notice && <div className="bg-alert bg-alert--ok">{notice}</div>}

      {!configured ? (
        <div className="bg-alert">
          Chưa cấu hình Bitget API. Thêm <code>BITGET_API_KEY</code>, <code>BITGET_API_SECRET</code>,{' '}
          <code>BITGET_API_PASSPHRASE</code> vào <code>.env</code> để mở lệnh.
        </div>
      ) : symbols.length === 0 ? (
        <div className="bg-alert">
          Chưa có coin nào trong lịch sử. Khi có lệnh đã đóng, chúng sẽ hiện ở đây để mở lại nhanh.
        </div>
      ) : (
        <>
        <div className="bg-table-toolbar">
          <div className="bg-toolbar-filter">
            <span className="bg-toolbar-label">Lọc coin:</span>
            <SymbolMultiSelect
              symbols={symbols}
              selected={selectedSymbols}
              onChange={setSelectedSymbols}
            />
            {selectedSymbols.length > 0 && (
              <button
                type="button"
                className="bg-toolbar-clear"
                onClick={() => setSelectedSymbols([])}
                title="Xoá bộ lọc"
              >
                ✕ Xoá lọc
              </button>
            )}
          </div>
          <div className="bg-toolbar-right">
            <button
              type="button"
              className="bg-bulk-btn"
              onClick={() => setBulkOpen(true)}
              title="Đặt đòn bẩy + ký quỹ cho nhiều coin cùng lúc (ghi đè cấu hình hiện tại)"
            >
              ⚙ Setup nhiều coin
            </button>
            <span className="bg-toolbar-count">
              {displaySymbols.length} coin
              {selectedSymbols.length > 0 ? ` (đã lọc từ ${symbols.length})` : ''}
            </span>
          </div>
        </div>
        {displaySymbols.length === 0 ? (
          <div className="bg-alert">Không có coin nào khớp bộ lọc.</div>
        ) : (
        <div className="bg-table-wrap">
          <table className="bg-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="bg-num">Giá</th>
                <SortHeader
                  label="Hôm nay"
                  col="today"
                  sort={sort}
                  onSort={cycleSort}
                  title="Sắp xếp theo thay đổi so với mốc 00:00 UTC — bấm để đổi chiều (mặc định không sắp xếp)"
                />
                <SortHeader
                  label="7 ngày"
                  col="d7"
                  sort={sort}
                  onSort={cycleSort}
                  title="Thay đổi giá 7 ngày (so với giá đóng cửa 7 ngày trước) — bấm để sắp xếp"
                />
                <SortHeader
                  label="30 ngày"
                  col="d30"
                  sort={sort}
                  onSort={cycleSort}
                  title="Thay đổi giá 30 ngày (so với giá đóng cửa 30 ngày trước) — bấm để sắp xếp"
                />
                <th title="Tín hiệu QQE Signals (colinmck) trên nến đã đóng — L=Long (xanh) / S=Short (đỏ) theo từng khung M30/H1/H4/D1">
                  QQE
                </th>
                <th>Long</th>
                <th>Short</th>
                <th className="bg-num" title="Xem lại các chart đã lưu cho coin này">
                  Tham chiếu
                </th>
              </tr>
            </thead>
            <tbody>
              {displaySymbols.map((symbol) => {
                const price = livePrices[symbol];
                const change = liveChanges[symbol];
                const pc = priceChanges[bareSymbol(symbol)];
                const change7d = pc?.change7d;
                const change30d = pc?.change30d;
                return (
                  <tr key={symbol}>
                    <td className="bg-symbol">
                      <div className="bg-symbol-cell">
                        <span>{symbol}</span>
                        <div className="bg-chart-btns">
                          <button
                            type="button"
                            className="bg-chart-btn"
                            onClick={() => setChartTarget({ symbol, tf: DEFAULT_CHART_TF })}
                            title="Xem chart (SonicR + S/R Channel + RSI) — chọn khung M30/H1/H4/D1 trong dialog"
                          >
                            📈 Chart
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="bg-num bg-price">{fmtPrice(price)}</td>
                    <td className={`bg-num ${chgClass(change)}`}>{fmtChange(change)}</td>
                    <td className={`bg-num ${chgClass(change7d)}`}>{fmtChange(change7d)}</td>
                    <td className={`bg-num ${chgClass(change30d)}`}>{fmtChange(change30d)}</td>
                    <td className="bg-qqe-cell">
                      <QqeCell signals={qqe[bareSymbol(symbol)]} />
                    </td>
                    {sides.map((holdSide) => {
                      const key = cfgKey(symbol, holdSide);
                      const cfg = configs[key];
                      const isOpen = openSides.has(key);
                      const configuredSide = Boolean(cfg && cfg.marginUsd > 0);
                      const opening = openingKey === key;
                      const isLong = holdSide === 'long';
                      return (
                        <td key={holdSide} className="bg-side-cell">
                          <div className="bg-side-cell-inner">
                            <div className="bg-side-cfg-row">
                              {isOpen ? (
                                <span className="bg-status-open">● Đang mở</span>
                              ) : configuredSide ? (
                                <span className="bg-side-cfg">
                                  {cfg!.leverage}× · {fmtUsdPlain(cfg!.marginUsd)} · cross
                                </span>
                              ) : (
                                <span className="bg-side-cfg bg-side-cfg--empty">chưa cấu hình</span>
                              )}
                            </div>
                            <div className="bg-setup-actions">
                              <button
                                type="button"
                                className="bg-setup-btn"
                                onClick={() => setEditing({ symbol, holdSide })}
                                title={`Cấu hình ${isLong ? 'LONG' : 'SHORT'} — đòn bẩy / ký quỹ`}
                              >
                                ⚙
                              </button>
                              {/* Always clickable — on an already-open side it adds
                                  volume to that position instead of opening a new one. */}
                              <button
                                type="button"
                                className={`bg-open-btn ${isLong ? 'bg-open-btn--long' : 'bg-open-btn--short'} ${
                                  isOpen ? 'bg-open-btn--add' : ''
                                }`}
                                onClick={() => openPosition(symbol, holdSide)}
                                disabled={opening || openingKey !== null}
                                title={
                                  isOpen
                                    ? `Thêm volume vào vị thế ${isLong ? 'LONG' : 'SHORT'} đang mở`
                                    : !configuredSide
                                      ? 'Cấu hình ký quỹ trước'
                                      : `Mở lệnh ${isLong ? 'LONG' : 'SHORT'} market`
                                }
                              >
                                {opening ? '…' : isOpen ? `+ ${isLong ? 'Long' : 'Short'}` : isLong ? 'Long' : 'Short'}
                              </button>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                    <td className="bg-num">
                      <button
                        type="button"
                        className="bg-ref-btn"
                        onClick={() => setRefSymbol(symbol)}
                        title="Xem lại các chart đã lưu cho coin này"
                      >
                        🖼 Reference
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}

      {editing && (
        <SetupDialog
          symbol={editing.symbol}
          holdSide={editing.holdSide}
          initial={configs[cfgKey(editing.symbol, editing.holdSide)]}
          onSave={(cfg) => {
            void saveConfig(editing.symbol, editing.holdSide, cfg);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {bulkOpen && (
        <BulkSetupDialog
          symbols={symbols}
          initialSymbols={selectedSymbols}
          configs={configs}
          saving={bulkSaving}
          onSave={(input) => void saveBulkConfig(input)}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {chartTarget && (
        <SetupChartDialog
          symbol={chartTarget.symbol}
          tf={chartTarget.tf}
          allowSave
          onClose={() => setChartTarget(null)}
        />
      )}

      {refSymbol && (
        <ChartGalleryDialog symbol={refSymbol} onClose={() => setRefSymbol(null)} />
      )}
    </div>
  );
}


/** A sortable numeric column header — cycles desc → asc → off on click. */
function SortHeader({
  label,
  col,
  sort,
  onSort,
  title,
}: {
  label: string;
  col: SortCol;
  sort: { col: SortCol; dir: 'desc' | 'asc' } | null;
  onSort: (col: SortCol) => void;
  title: string;
}) {
  const dir = sort?.col === col ? sort.dir : null;
  return (
    <th
      className="bg-num bg-th-sort"
      aria-sort={dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : 'none'}
    >
      <button type="button" className="bg-th-sort-btn" onClick={() => onSort(col)} title={title}>
        {label}
        <span className="bg-th-sort-ind">{dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '↕'}</span>
      </button>
    </th>
  );
}

/** Saved-at timestamp formatted for the gallery caption. */
function fmtSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Reference gallery for a coin's saved charts — laid out like a product image
 * viewer: a big main image on the right with a rail of clickable thumbnails on
 * the left. The stored PNGs live on public R2, so they load straight from `url`.
 */
function ChartGalleryDialog({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const clientRef = useRef(createApiClient());
  const [charts, setCharts] = useState<BitgetTradeChart[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCharts(null);
    setFailed(false);
    clientRef.current
      .fetchBitgetSavedChartsBySymbol(symbol)
      .then((list) => {
        if (!alive) return;
        setCharts(list);
        setActiveId(list[0]?.id ?? null);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [symbol]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const active = charts?.find((c) => c.id === activeId) ?? charts?.[0] ?? null;
  const count = charts?.length ?? 0;

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--fullscreen eb-chart-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            {symbol} <span className="eb-chart-note">· Chart tham chiếu đã lưu</span>
            {count > 0 && <span className="bg-gallery-count">{count} ảnh</span>}
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="dialog-body bg-gallery-body">
          {failed ? (
            <div className="eb-chart-status">Không tải được danh sách chart. Thử lại sau.</div>
          ) : charts == null ? (
            <div className="eb-chart-status">Đang tải…</div>
          ) : charts.length === 0 ? (
            <div className="eb-chart-status">
              Chưa có chart nào được lưu cho {symbol}. Vào tab “Lịch sử &amp; PnL”, mở chart một
              lệnh rồi bấm “Lưu chart” để lưu tham chiếu.
            </div>
          ) : (
            <div className="bg-gallery">
              <div className="bg-gallery-rail" role="tablist" aria-label="Danh sách chart">
                {charts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={c.id === active?.id}
                    className={`bg-gallery-thumb ${c.id === active?.id ? 'bg-gallery-thumb--active' : ''}`}
                    onClick={() => setActiveId(c.id)}
                    title={`${tfLabelOf(c.timeframe)} · ${fmtSavedAt(c.createdAt)}`}
                  >
                    <img src={c.url} alt={`${symbol} ${tfLabelOf(c.timeframe)}`} loading="lazy" />
                    <span className="bg-gallery-thumb-tf">{tfLabelOf(c.timeframe)}</span>
                    {c.note && (
                      <span className="bg-gallery-thumb-note" title="Có ghi chú">
                        📝
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="bg-gallery-main">
                {active && (
                  <>
                    <a
                      className="bg-gallery-main-img"
                      href={active.url}
                      target="_blank"
                      rel="noreferrer"
                      title="Mở ảnh gốc trong tab mới"
                    >
                      <img src={active.url} alt={`${symbol} ${tfLabelOf(active.timeframe)} chart`} />
                    </a>
                    <div className="bg-gallery-caption">
                      <span className="bg-gallery-caption-tf">{tfLabelOf(active.timeframe)}</span>
                      <span className="bg-gallery-caption-date">Lưu lúc {fmtSavedAt(active.createdAt)}</span>
                    </div>
                    <ChartNoteView note={active.note} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const DEFAULT_LEVERAGE = 10;

function SetupDialog({
  symbol,
  holdSide,
  initial,
  onSave,
  onClose,
}: {
  symbol: string;
  holdSide: HoldSide;
  initial: BitgetSetupConfig | undefined;
  onSave: (cfg: { leverage: number; marginUsd: number }) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [leverage, setLeverage] = useState(String(initial?.leverage ?? DEFAULT_LEVERAGE));
  const [marginUsd, setMarginUsd] = useState(
    initial && initial.marginUsd > 0 ? String(initial.marginUsd) : '',
  );

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lev = Number(leverage);
  const margin = Number(marginUsd);
  const valid = Number.isFinite(lev) && lev >= 1 && lev <= 125 && Number.isFinite(margin) && margin > 0;
  const notional = valid ? margin * lev : 0;
  const isLong = holdSide === 'long';

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div
        className="bg-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Cấu hình ${symbol} ${holdSide}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-setup-head">
          <h3>
            Cấu hình {symbol}{' '}
            <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
              {isLong ? 'LONG' : 'SHORT'}
            </span>
          </h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className="bg-setup-body">
          <label className="bg-setup-field">
            <span>Đòn bẩy (×)</span>
            <input
              type="number"
              min={1}
              max={125}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
            />
          </label>

          <label className="bg-setup-field">
            <span>Loại lệnh / Margin</span>
            <input type="text" value="Market · Cross" disabled />
          </label>

          <label className="bg-setup-field">
            <span>Ký quỹ (USDT)</span>
            <input
              type="number"
              min={0}
              step="any"
              value={marginUsd}
              placeholder="vd: 20"
              onChange={(e) => setMarginUsd(e.target.value)}
            />
          </label>

          <p className="bg-setup-note">
            Giá trị lệnh (notional) ≈{' '}
            <strong>{valid ? `$${notional.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</strong>{' '}
            = ký quỹ × đòn bẩy. Size sẽ được tính theo giá market khi bấm Open.
          </p>
        </div>

        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose}>
            Huỷ
          </button>
          <button
            type="button"
            className="bg-setup-save"
            disabled={!valid}
            onClick={() => onSave({ leverage: lev, marginUsd: margin })}
          >
            Lưu
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
