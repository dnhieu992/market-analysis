'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  BitgetAutoTrade,
  BitgetHistoryResponse,
  BitgetPositionsResponse,
  BitgetPriceChange,
  BitgetSetupConfig,
  MexcHistoryResponse,
  MexcPositionsResponse,
  TradingExchange,
  TradingListNote,
  TradingListWatchlistSymbol,
} from '@web/shared/api/types';
import { SymbolSearchFilter } from '@web/shared/ui/symbol-search-filter/symbol-search-filter';

import { useBitgetLivePrices } from '../bitget-positions/use-bitget-live-prices';
import { useMexcLivePrices } from '../mexc-positions/use-mexc-live-prices';
import { ChartIcon } from '../bitget/chart-icon';
import { LimitOrderDialog as BitgetLimitOrderDialog } from '../bitget/limit-order-dialog';
import { QqeCell, bareQqeSymbol as bareSymbol, type QqeMap } from '../bitget/qqe-cell';
import { DEFAULT_CHART_TF, SetupChartDialog } from '../bitget/setup-chart-dialog';
import { StarRating } from '../bitget/star-rating';
import { SymbolNoteDialog, notePreview } from '../bitget/symbol-note-dialog';
import { matchesSymbolSelection } from '../bitget/symbol-filter-input';
import { LimitOrderDialog as MexcLimitOrderDialog } from '../mexc/limit-order-dialog';
import { AddCoinDialog } from './add-coin-dialog';
import { ExchangeConfigDialog, type ExchangeConfigInput } from './exchange-config-dialog';
import { EXCHANGES, EXCHANGE_LABEL, EXCHANGE_SHORT } from './exchanges';

import styles from './trading-list.module.css';

const REFRESH_MS = 15_000;
// QQE readings only change on candle close — poll on a slower cadence than positions.
const QQE_REFRESH_MS = 60_000;
// 7d / 30d change only moves once a day — poll rarely.
const CHANGE_REFRESH_MS = 5 * 60_000;

type SortCol = 'priority' | 'today' | 'h4' | 'd7' | 'd30';
const DEFAULT_SORT: { col: SortCol; dir: 'desc' | 'asc' } = { col: 'priority', dir: 'desc' };

// Same pins + built-in watchlist as the /bitget and /mexc Setup tabs.
const PINNED_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
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
  'OPUSDT',
  'ETCUSDT',
  'ASTERUSDT',
  'TAOUSDT',
  'LTCUSDT',
];

/**
 * The coins /trading-list shows: pins, the built-in watchlist, the coins added
 * by hand, then every coin ever traded on either exchange (newest close first).
 */
export function tradingListSymbols(
  trades: Array<{ symbol: string; closedAt: string }>,
  extra: string[] = [],
): string[] {
  const lastClose = new Map<string, number>();
  for (const t of trades) {
    const ts = new Date(t.closedAt).getTime();
    if (ts > (lastClose.get(t.symbol) ?? 0)) lastClose.set(t.symbol, ts);
  }
  const traded = [...lastClose.keys()].sort((a, b) => (lastClose.get(b) ?? 0) - (lastClose.get(a) ?? 0));
  return [...new Set([...PINNED_SYMBOLS, ...WATCHLIST_SYMBOLS, ...extra, ...traded])];
}

type HoldSide = 'long' | 'short';
type SideConfig = { leverage: number; marginUsd: number };
/** Per-exchange config keyed by `${symbol}-${holdSide}`. */
type ConfigMap = Record<string, SideConfig>;

const cfgKey = (symbol: string, holdSide: HoldSide) => `${symbol}-${holdSide}`;
const actKey = (ex: TradingExchange, symbol: string, holdSide: HoldSide) => `${ex}-${symbol}-${holdSide}`;

function toConfigMap(list: BitgetSetupConfig[]): ConfigMap {
  const map: ConfigMap = {};
  for (const c of list) map[cfgKey(c.symbol, c.holdSide)] = { leverage: c.leverage, marginUsd: c.marginUsd };
  return map;
}

function fmtUsdPlain(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Adaptive precision so both $60,000 BTC and $0.0000123 coins read cleanly. */
function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtChange(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function chgClass(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '';
  return ratio > 0 ? 'bg-chg--up' : ratio < 0 ? 'bg-chg--down' : '';
}

type Props = {
  bitgetHistory: BitgetHistoryResponse;
  mexcHistory: MexcHistoryResponse;
  bitgetPositions: BitgetPositionsResponse;
  mexcPositions: MexcPositionsResponse;
};

/**
 * /trading-list coin table: one row per coin for both exchanges. Price, change,
 * QQE, stars and the assessment are per coin; each LONG / SHORT cell carries a
 * [BG] and an [MX] line with that exchange's own config, "đang mở" state and
 * Market / Limit buttons. Stars, notes and hand-added coins live in the
 * trading-list tables (not the /bitget or /mexc ones); configs are per exchange.
 */
export function TradingListFeed({ bitgetHistory, mexcHistory, bitgetPositions, mexcPositions }: Props) {
  const clientRef = useRef(createApiClient());
  const [bgPositions, setBgPositions] = useState(bitgetPositions);
  const [mxPositions, setMxPositions] = useState(mexcPositions);
  const [configs, setConfigs] = useState<Record<TradingExchange, ConfigMap>>({ bitget: {}, mexc: {} });
  const [autoTrades, setAutoTrades] = useState<Record<string, BitgetAutoTrade>>({});
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, TradingListNote>>({});
  const [watchlist, setWatchlist] = useState<TradingListWatchlistSymbol[]>([]);
  const [qqe, setQqe] = useState<QqeMap>({});
  const [priceChanges, setPriceChanges] = useState<Record<string, BitgetPriceChange>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [limitTarget, setLimitTarget] = useState<{ ex: TradingExchange; symbol: string; holdSide: HoldSide } | null>(null);
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sort, setSort] = useState<{ col: SortCol; dir: 'desc' | 'asc' } | null>(DEFAULT_SORT);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const toggleSymbol = useCallback((symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }, []);

  // Hydrate everything the table reads once; each source is non-fatal on its own.
  useEffect(() => {
    let alive = true;
    const api = clientRef.current;
    api.fetchBitgetSetupConfigs().then((l) => alive && setConfigs((p) => ({ ...p, bitget: toConfigMap(l) }))).catch(() => {});
    api.fetchMexcSetupConfigs().then((l) => alive && setConfigs((p) => ({ ...p, mexc: toConfigMap(l) }))).catch(() => {});
    api
      .fetchBitgetAutoTrades()
      .then((l) => alive && setAutoTrades(Object.fromEntries(l.map((a) => [a.symbol, a]))))
      .catch(() => {});
    api
      .fetchTradingListPriorities()
      .then((l) => alive && setPriorities(Object.fromEntries(l.map((p) => [p.symbol, p.priority]))))
      .catch(() => {});
    api
      .fetchTradingListNotes()
      .then((l) => alive && setNotes(Object.fromEntries(l.map((n) => [n.symbol, n]))))
      .catch(() => {});
    api.fetchTradingListWatchlist().then((l) => alive && setWatchlist(l)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const extraSymbols = useMemo(() => watchlist.map((w) => w.symbol), [watchlist]);
  const symbols = useMemo(
    () => tradingListSymbols([...bitgetHistory.trades, ...mexcHistory.trades], extraSymbols),
    [bitgetHistory.trades, mexcHistory.trades, extraSymbols],
  );

  const openSides = useMemo(
    () =>
      new Set([
        ...bgPositions.positions.map((p) => actKey('bitget', p.symbol, p.holdSide)),
        ...mxPositions.positions.map((p) => actKey('mexc', p.symbol, p.holdSide)),
      ]),
    [bgPositions.positions, mxPositions.positions],
  );

  // Realtime price per exchange; the row shows Bitget's and falls back to MEXC's.
  const bgLive = useBitgetLivePrices(symbols);
  const mxLive = useMexcLivePrices(symbols);
  const priceOf = useCallback(
    (symbol: string) => bgLive.prices[symbol] ?? mxLive.prices[symbol] ?? null,
    [bgLive.prices, mxLive.prices],
  );
  const changeOf = useCallback(
    (symbol: string) => bgLive.changes[symbol] ?? mxLive.changes[symbol] ?? null,
    [bgLive.changes, mxLive.changes],
  );

  const sortValue = useCallback(
    (symbol: string, col: SortCol): number | null => {
      if (col === 'priority') return priorities[symbol] ?? 0;
      if (col === 'today') {
        const v = changeOf(symbol);
        return v == null || !Number.isFinite(v) ? null : v;
      }
      const c = priceChanges[bareSymbol(symbol)];
      const v = col === 'h4' ? c?.changeH4 : col === 'd7' ? c?.change7d : c?.change30d;
      return v == null || !Number.isFinite(v) ? null : v;
    },
    [changeOf, priceChanges, priorities],
  );

  const displaySymbols = useMemo(() => {
    const base = selectedSymbols.size === 0 ? symbols : symbols.filter((s) => matchesSymbolSelection(s, selectedSymbols));
    if (!sort) return base;
    const miss = sort.dir === 'desc' ? -Infinity : Infinity;
    return [...base].sort((a, b) => {
      const va = sortValue(a, sort.col) ?? miss;
      const vb = sortValue(b, sort.col) ?? miss;
      return sort.dir === 'desc' ? vb - va : va - vb;
    });
  }, [symbols, selectedSymbols, sort, sortValue]);

  const cycleSort = useCallback((col: SortCol) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'desc' };
      return prev.dir === 'desc' ? { col, dir: 'asc' } : DEFAULT_SORT;
    });
  }, []);

  const refreshPositions = useCallback(async () => {
    const [bg, mx] = await Promise.all([
      clientRef.current.fetchBitgetPositions().catch(() => null),
      clientRef.current.fetchMexcPositions().catch(() => null),
    ]);
    if (bg) setBgPositions(bg);
    if (mx) setMxPositions(mx);
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refreshPositions(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshPositions]);

  // QQE + 7d/30d/H4 come from Binance candles (via the Bitget endpoints), so one source serves both exchanges.
  useEffect(() => {
    if (symbols.length === 0) return;
    const load = () =>
      clientRef.current
        .fetchBitgetQqeSignals(symbols)
        .then((rows) =>
          setQqe((prev) => {
            const next = { ...prev };
            for (const r of rows) next[r.symbol] = r.signals;
            return next;
          }),
        )
        .catch(() => {});
    void load();
    const id = setInterval(() => void load(), QQE_REFRESH_MS);
    return () => clearInterval(id);
  }, [symbols]);

  useEffect(() => {
    if (symbols.length === 0) return;
    const load = () =>
      clientRef.current
        .fetchBitgetPriceChanges(symbols)
        .then((rows) =>
          setPriceChanges((prev) => {
            const next = { ...prev };
            for (const r of rows) next[r.symbol] = r;
            return next;
          }),
        )
        .catch(() => {});
    void load();
    const id = setInterval(() => void load(), CHANGE_REFRESH_MS);
    return () => clearInterval(id);
  }, [symbols]);

  const savePriority = useCallback(
    async (symbol: string, priority: number) => {
      const previous = priorities[symbol] ?? 0;
      setPriorities((prev) => ({ ...prev, [symbol]: priority }));
      setError(null);
      try {
        await clientRef.current.saveTradingListPriority({ symbol, priority });
      } catch (err) {
        setPriorities((prev) => ({ ...prev, [symbol]: previous }));
        setError(err instanceof Error ? err.message : 'Lưu mức ưu tiên thất bại. Thử lại sau.');
      }
    },
    [priorities],
  );

  const saveNote = useCallback(async (symbol: string, note: string) => {
    setNoteSaving(true);
    setNoteError(null);
    try {
      const saved = await clientRef.current.saveTradingListNote({ symbol, note });
      setNotes((prev) => {
        const next = { ...prev };
        if (saved.note.trim()) next[symbol] = saved;
        else delete next[symbol];
        return next;
      });
      setNoteTarget(null);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Lưu đánh giá thất bại.');
    } finally {
      setNoteSaving(false);
    }
  }, []);

  /** Save each exchange × side whose numbers changed (the ⚙ dialog covers both exchanges). */
  const saveConfigs = useCallback(
    async (symbol: string, input: ExchangeConfigInput) => {
      setEditSaving(true);
      setEditError(null);
      setError(null);
      setNotice(null);
      try {
        const done: string[] = [];
        for (const ex of EXCHANGES) {
          for (const holdSide of ['long', 'short'] as const) {
            const cfg = input[ex][holdSide];
            if (!cfg) continue;
            const prev = configs[ex][cfgKey(symbol, holdSide)];
            if (prev && prev.leverage === cfg.leverage && prev.marginUsd === cfg.marginUsd) continue;
            const body = { symbol, holdSide, ...cfg };
            const saved = ex === 'bitget'
              ? await clientRef.current.saveBitgetSetupConfig(body)
              : await clientRef.current.saveMexcSetupConfig(body);
            setConfigs((p) => ({
              ...p,
              [ex]: { ...p[ex], [cfgKey(saved.symbol, saved.holdSide)]: { leverage: saved.leverage, marginUsd: saved.marginUsd } },
            }));
            done.push(`${EXCHANGE_SHORT[ex]} ${holdSide.toUpperCase()} ${saved.leverage}× · $${saved.marginUsd}`);
          }
        }
        setEditing(null);
        setNotice(done.length ? `Đã lưu cấu hình ${symbol}: ${done.join(' — ')}.` : `Cấu hình ${symbol} không đổi.`);
      } catch (err) {
        setEditError(err instanceof Error ? err.message : 'Lưu cấu hình thất bại. Thử lại sau.');
      } finally {
        setEditSaving(false);
      }
    },
    [configs],
  );

  const openPosition = useCallback(
    async (ex: TradingExchange, symbol: string, holdSide: HoldSide) => {
      const cfg = configs[ex][cfgKey(symbol, holdSide)];
      const name = EXCHANGE_LABEL[ex].toUpperCase();
      if (!cfg || !(cfg.marginUsd > 0)) {
        setError(`Cấu hình ký quỹ ${symbol} ${holdSide.toUpperCase()} trên ${EXCHANGE_LABEL[ex]} trước khi mở lệnh (bấm ⚙).`);
        return;
      }
      const key = actKey(ex, symbol, holdSide);
      const isAdd = openSides.has(key);
      const confirmText = isAdd
        ? `[${name}] ${symbol} đang có vị thế ${holdSide.toUpperCase()} mở.\n` +
          `THÊM VOLUME vào lệnh đó theo giá market ngay bây giờ?\n` +
          `Ký quỹ thêm $${cfg.marginUsd} · đòn bẩy của vị thế đang mở · cross`
        : `[${name}] Mở lệnh ${holdSide.toUpperCase()} ${symbol} theo giá market ngay bây giờ?\n` +
          `Ký quỹ $${cfg.marginUsd} · đòn bẩy ${cfg.leverage}× · cross`;
      if (!window.confirm(confirmText)) return;

      setOpeningKey(key);
      setError(null);
      setNotice(null);
      try {
        const body = { symbol, holdSide, marginUsd: cfg.marginUsd, leverage: cfg.leverage };
        const res = ex === 'bitget'
          ? await clientRef.current.openBitgetPosition(body)
          : await clientRef.current.openMexcPosition(body);
        setNotice(
          res.mode === 'add'
            ? `[${EXCHANGE_LABEL[ex]}] Đã thêm volume vào ${res.holdSide.toUpperCase()} ${symbol}: +${res.size} @ ~${res.entryPrice} ` +
                `(tổng size ${res.totalSize}, ${res.leverage}×).`
            : `[${EXCHANGE_LABEL[ex]}] Đã mở ${res.holdSide.toUpperCase()} ${symbol}: size ${res.size} @ ~${res.entryPrice}.`,
        );
        await refreshPositions();
      } catch (err) {
        setError(`[${EXCHANGE_LABEL[ex]}] ${err instanceof Error ? err.message : 'Mở lệnh thất bại. Thử lại sau.'}`);
      } finally {
        setOpeningKey(null);
      }
    },
    [configs, openSides, refreshPositions],
  );

  const placeLimit = useCallback(
    async (ex: TradingExchange, symbol: string, holdSide: HoldSide, input: { leverage: number; marginUsd: number; price: number }) => {
      setLimitSaving(true);
      setLimitError(null);
      setError(null);
      setNotice(null);
      try {
        const body = { symbol, holdSide, ...input };
        const res = ex === 'bitget'
          ? await clientRef.current.placeBitgetLimitOrder(body)
          : await clientRef.current.placeMexcLimitOrder(body);
        setLimitTarget(null);
        setNotice(
          `[${EXCHANGE_LABEL[ex]}] Đã đặt lệnh limit ${res.holdSide.toUpperCase()} ${symbol}: size ${res.size} @ ${res.price} ` +
            `(ký quỹ $${res.marginUsd} · ${res.leverage}× cross). Xem ở /${ex} → Lệnh chờ.`,
        );
      } catch (err) {
        setLimitError(err instanceof Error ? err.message : 'Đặt lệnh limit thất bại. Thử lại sau.');
      } finally {
        setLimitSaving(false);
      }
    },
    [],
  );

  const addCoin = useCallback(async (symbol: string) => {
    const row = await clientRef.current.addTradingListWatchlistSymbol(symbol);
    setWatchlist((prev) => (prev.some((w) => w.symbol === row.symbol) ? prev : [...prev, row]));
  }, []);

  const removeCoin = useCallback(async (symbol: string) => {
    await clientRef.current.deleteTradingListWatchlistSymbol(symbol);
    setWatchlist((prev) => prev.filter((w) => w.symbol !== symbol));
  }, []);

  const live = bgLive.live || mxLive.live;
  const limitCfg = limitTarget ? configs[limitTarget.ex][cfgKey(limitTarget.symbol, limitTarget.holdSide)] : undefined;
  const limitPrice = limitTarget
    ? (limitTarget.ex === 'bitget' ? bgLive.prices : mxLive.prices)[limitTarget.symbol] ?? priceOf(limitTarget.symbol)
    : null;
  const LimitDialog = limitTarget?.ex === 'mexc' ? MexcLimitOrderDialog : BitgetLimitOrderDialog;

  return (
    <div className="bg-panel">
      <div className="bg-head">
        <div className={styles.legend}>
          {EXCHANGES.map((ex) => (
            <span key={ex} className={`${styles.exTag} ${styles[`ex_${ex}`]}`}>
              {EXCHANGE_SHORT[ex]} = {EXCHANGE_LABEL[ex]}
            </span>
          ))}
        </div>
        <div className="bg-head-actions">
          <span className={`bg-live ${live ? 'bg-live--on' : ''}`} title={`Giá realtime · Bitget ${bgLive.live ? 'on' : 'off'} · MEXC ${mxLive.live ? 'on' : 'off'}`}>
            <span className="bg-live-dot" />
            {live ? 'Realtime' : 'Đang kết nối…'}
          </span>
          <button type="button" className="bg-bulk-btn" onClick={() => setAddOpen(true)} title="Thêm coin vào danh sách (dùng chung 2 sàn)">
            + Thêm coin
          </button>
          <button className="bg-refresh" onClick={() => void refreshPositions()}>
            ↻ Làm mới
          </button>
        </div>
      </div>

      {error && <div className="bg-alert bg-alert--error">{error}</div>}
      {notice && <div className="bg-alert bg-alert--ok">{notice}</div>}

      <div className="bg-table-toolbar">
        <div className="bg-toolbar-filter pf-coin-filter">
          <span className="bg-toolbar-label">Lọc coin:</span>
          <SymbolSearchFilter symbols={symbols} selected={selectedSymbols} onToggle={toggleSymbol} count={displaySymbols.length} />
          {selectedSymbols.size > 0 && (
            <button type="button" className="bg-toolbar-clear" onClick={() => setSelectedSymbols(new Set())} title="Xoá bộ lọc">
              ✕ Xoá lọc
            </button>
          )}
        </div>
      </div>

      {displaySymbols.length === 0 ? (
        <div className="bg-alert">Không có coin nào khớp bộ lọc.</div>
      ) : (
        <div className="bg-table-wrap">
          <table className={`bg-table ${styles.table}`}>
            <thead>
              <tr>
                <th title="Sao ưu tiên (0–5, dùng chung 2 sàn) — bảng mặc định xếp theo sao">Symbol</th>
                <th className="bg-num" title="Giá Bitget (thiếu thì lấy MEXC)">Giá</th>
                <SortHeader label="Hôm nay" col="today" sort={sort} onSort={cycleSort} title="Thay đổi hôm nay (Bitget, thiếu thì MEXC 24h)" />
                <SortHeader label="7 ngày" col="d7" sort={sort} onSort={cycleSort} title="Thay đổi giá 7 ngày" />
                <SortHeader label="30 ngày" col="d30" sort={sort} onSort={cycleSort} title="Thay đổi giá 30 ngày" />
                <SortHeader label="H4" col="h4" sort={sort} onSort={cycleSort} title="Nến H4 đã đóng gần nhất" />
                <th title="QQE Signals trên nến đã đóng — M30/H1/H4/D1">QQE</th>
                <th title="Đánh giá dùng chung 2 sàn — bấm để soạn">Đánh giá</th>
                <th>Long</th>
                <th>Short</th>
              </tr>
            </thead>
            <tbody>
              {displaySymbols.map((symbol) => {
                const change = changeOf(symbol);
                const pc = priceChanges[bareSymbol(symbol)];
                const note = notes[symbol];
                const auto = autoTrades[symbol];
                return (
                  <tr key={symbol}>
                    <td className="bg-symbol">
                      <div className="bg-symbol-cell">
                        <span className="bg-symbol-name">
                          {symbol}
                          <button
                            type="button"
                            className="bg-chart-icon-btn"
                            onClick={() => setChartSymbol(symbol)}
                            title="Xem chart"
                            aria-label={`Xem chart ${symbol}`}
                          >
                            <ChartIcon />
                          </button>
                          <button
                            type="button"
                            className="bg-setup-btn bg-setup-btn--coin"
                            onClick={() => {
                              setEditError(null);
                              setEditing(symbol);
                            }}
                            title={`Cấu hình ${symbol} — đòn bẩy/ký quỹ LONG & SHORT trên Bitget và MEXC`}
                            aria-label={`Cấu hình ${symbol}`}
                          >
                            ⚙
                          </button>
                          {auto?.enabled && (
                            <span className="bg-auto-badge" title="Auto vào lệnh đang bật trên Bitget (chỉnh ở /bitget)">
                              AUTO
                            </span>
                          )}
                        </span>
                        <StarRating value={priorities[symbol] ?? 0} symbol={symbol} onChange={(next) => void savePriority(symbol, next)} />
                      </div>
                    </td>
                    <td className="bg-num bg-price">{fmtPrice(priceOf(symbol))}</td>
                    <td className={`bg-num ${chgClass(change)}`}>{fmtChange(change)}</td>
                    <td className={`bg-num ${chgClass(pc?.change7d)}`}>{fmtChange(pc?.change7d)}</td>
                    <td className={`bg-num ${chgClass(pc?.change30d)}`}>{fmtChange(pc?.change30d)}</td>
                    <td className={`bg-num ${chgClass(pc?.changeH4)}`}>{fmtChange(pc?.changeH4)}</td>
                    <td className="bg-qqe-cell">
                      <QqeCell signals={qqe[bareSymbol(symbol)]} />
                    </td>
                    <td className="bg-note-cell">
                      <button
                        type="button"
                        className={`bg-note-btn ${note ? '' : 'bg-note-btn--empty'}`}
                        onClick={() => {
                          setNoteError(null);
                          setNoteTarget(symbol);
                        }}
                        title={note ? note.note : `Viết đánh giá cho ${symbol}`}
                      >
                        {note ? notePreview(note.note) : '+ Đánh giá'}
                      </button>
                    </td>
                    {(['long', 'short'] as const).map((holdSide) => (
                      <td key={holdSide} className={`bg-side-cell ${styles.sideCell}`}>
                        {EXCHANGES.map((ex) => {
                          const key = actKey(ex, symbol, holdSide);
                          const cfg = configs[ex][cfgKey(symbol, holdSide)];
                          const isOpen = openSides.has(key);
                          const configuredSide = Boolean(cfg && cfg.marginUsd > 0);
                          const isLong = holdSide === 'long';
                          return (
                            <div key={ex} className={styles.exLine}>
                              <span className={`${styles.exTag} ${styles[`ex_${ex}`]}`} title={EXCHANGE_LABEL[ex]}>
                                {EXCHANGE_SHORT[ex]}
                              </span>
                              <span className={styles.exCfg}>
                                {isOpen ? (
                                  <span className="bg-status-open">● Đang mở</span>
                                ) : configuredSide ? (
                                  <span className="bg-side-cfg">
                                    {cfg!.leverage}× · {fmtUsdPlain(cfg!.marginUsd)}
                                  </span>
                                ) : (
                                  <span className="bg-side-cfg bg-side-cfg--empty">chưa cấu hình</span>
                                )}
                              </span>
                              <span className="bg-setup-actions">
                                <button
                                  type="button"
                                  className={`bg-open-btn ${isLong ? 'bg-open-btn--long' : 'bg-open-btn--short'} ${isOpen ? 'bg-open-btn--add' : ''}`}
                                  onClick={() => void openPosition(ex, symbol, holdSide)}
                                  disabled={openingKey !== null}
                                  title={
                                    isOpen
                                      ? `[${EXCHANGE_LABEL[ex]}] Thêm volume vào vị thế ${holdSide.toUpperCase()} đang mở theo giá market`
                                      : !configuredSide
                                        ? `Cấu hình ký quỹ trên ${EXCHANGE_LABEL[ex]} trước`
                                        : `[${EXCHANGE_LABEL[ex]}] Mở lệnh ${holdSide.toUpperCase()} theo giá market`
                                  }
                                >
                                  {openingKey === key ? '…' : isOpen ? '+ Market' : 'Market'}
                                </button>
                                <button
                                  type="button"
                                  className={`bg-limit-btn ${isLong ? 'bg-limit-btn--long' : 'bg-limit-btn--short'}`}
                                  onClick={() => {
                                    setLimitError(null);
                                    setLimitTarget({ ex, symbol, holdSide });
                                  }}
                                  title={`[${EXCHANGE_LABEL[ex]}] Đặt lệnh ${holdSide.toUpperCase()} limit`}
                                >
                                  Limit
                                </button>
                              </span>
                            </div>
                          );
                        })}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ExchangeConfigDialog
          symbol={editing}
          configs={{
            bitget: { long: configs.bitget[cfgKey(editing, 'long')], short: configs.bitget[cfgKey(editing, 'short')] },
            mexc: { long: configs.mexc[cfgKey(editing, 'long')], short: configs.mexc[cfgKey(editing, 'short')] },
          }}
          saving={editSaving}
          error={editError}
          onSave={(input) => void saveConfigs(editing, input)}
          onClose={() => setEditing(null)}
        />
      )}

      {limitTarget && (
        <LimitDialog
          symbol={limitTarget.symbol}
          holdSide={limitTarget.holdSide}
          currentPrice={limitPrice}
          initialLeverage={limitCfg?.leverage ?? 0}
          initialMarginUsd={limitCfg?.marginUsd ?? 0}
          saving={limitSaving}
          error={limitError}
          onPlace={(input) => void placeLimit(limitTarget.ex, limitTarget.symbol, limitTarget.holdSide, input)}
          onClose={() => setLimitTarget(null)}
        />
      )}

      {noteTarget && (
        <SymbolNoteDialog
          symbol={noteTarget}
          initialNote={notes[noteTarget]?.note ?? ''}
          updatedAt={notes[noteTarget]?.updatedAt ?? null}
          saving={noteSaving}
          error={noteError}
          onSave={(note) => void saveNote(noteTarget, note)}
          onClose={() => setNoteTarget(null)}
        />
      )}

      {chartSymbol && <SetupChartDialog symbol={chartSymbol} tf={DEFAULT_CHART_TF} onClose={() => setChartSymbol(null)} />}

      {addOpen && <AddCoinDialog tracked={watchlist} onAdd={addCoin} onRemove={removeCoin} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

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
    <th className="bg-num bg-th-sort" aria-sort={dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : 'none'}>
      <button type="button" className="bg-th-sort-btn" onClick={() => onSort(col)} title={title}>
        {label}
        <span className="bg-th-sort-ind">{dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '↕'}</span>
      </button>
    </th>
  );
}
