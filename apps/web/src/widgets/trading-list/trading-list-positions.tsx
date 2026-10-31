'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  BitgetPendingOrder,
  BitgetPosition,
  BitgetPositionsResponse,
  MexcPositionsResponse,
  TradingExchange,
} from '@web/shared/api/types';

import { SetupChartDialog as BitgetSetupChartDialog } from '../bitget/setup-chart-dialog';
import { ChartIcon } from '../bitget/chart-icon';
import { SymbolChipFilter, matchesSymbolSelection } from '../bitget/symbol-filter-input';
import { BitgetJournalDrawer, tradeKeyOf } from '../bitget-positions/bitget-journal-drawer';
import { TpslDialog as BitgetTpslDialog } from '../bitget-positions/tpsl-dialog';
import { useBitgetLivePrices } from '../bitget-positions/use-bitget-live-prices';
import { BtcPriceTile } from '../btc-price-tile/btc-price-tile';
import { SetupChartDialog as MexcSetupChartDialog } from '../mexc/setup-chart-dialog';
import { MexcJournalDrawer } from '../mexc-positions/mexc-journal-drawer';
import { TpslDialog as MexcTpslDialog } from '../mexc-positions/tpsl-dialog';
import { useMexcLivePrices } from '../mexc-positions/use-mexc-live-prices';
import { ExchangeFilterBar } from './exchange-filter';
import { EXCHANGE_LABEL, EXCHANGE_SHORT, exchangesOf, type ExchangeFilter } from './exchanges';

import styles from './trading-list.module.css';

const REFRESH_MS = 15_000;
// Own key: the privacy toggle here does not flip the one on /bitget or /mexc.
const SHOW_VALUE_KEY = 'trading-list:pnl-show-value';
const BTC_SYMBOL = 'BTCUSDT';

// Bitget and MEXC positions / pending orders share one shape; the Bitget type stands for both.
type Position = BitgetPosition;
type PendingOrder = BitgetPendingOrder;
type HoldSide = 'long' | 'short';
type Row = { ex: TradingExchange; p: Position };
type PendingRow = { ex: TradingExchange; o: PendingOrder };
type PosKey = { ex: TradingExchange; symbol: string; holdSide: HoldSide };

const rowKey = (ex: TradingExchange, symbol: string, holdSide: HoldSide) => `${ex}-${symbol}-${holdSide}`;
const pendingKey = (ex: TradingExchange, orderId: string) => `${ex}-${orderId}`;

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUsdPlain(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
}

function fmtQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function pnlClass(n: number): string {
  if (n > 0) return 'bg-pnl--up';
  if (n < 0) return 'bg-pnl--down';
  return '';
}

/** Short local time (HH:mm) for the "Đặt lúc" column. */
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** "Bitget (2) + MEXC (1)" — names which exchanges a bulk action touches. */
function describeByExchange(rows: Array<{ ex: TradingExchange }>): string {
  const counts = new Map<TradingExchange, number>();
  for (const r of rows) counts.set(r.ex, (counts.get(r.ex) ?? 0) + 1);
  return [...counts].map(([ex, n]) => `${EXCHANGE_LABEL[ex]} (${n})`).join(' + ');
}

function ExTag({ ex }: { ex: TradingExchange }) {
  return (
    <span className={`${styles.exTag} ${styles[`ex_${ex}`]}`} title={EXCHANGE_LABEL[ex]}>
      {EXCHANGE_SHORT[ex]}
    </span>
  );
}

type Props = {
  bitgetPositions: BitgetPositionsResponse;
  mexcPositions: MexcPositionsResponse;
  filter: ExchangeFilter;
  onFilterChange: (next: ExchangeFilter) => void;
  /** Reports how many positions the current filter shows, for the tab label. */
  onCount?: (count: number) => void;
};

/**
 * "Vị thế" tab of /trading-list: open positions and resting limit orders of
 * Bitget and MEXC in one table each, tagged BG / MX. Same actions as the
 * /bitget and /mexc tabs (close, TP/SL, cancel, journal, chart), each sent to
 * the row's own exchange. Tiles follow the exchange filter.
 */
export function TradingListPositions({ bitgetPositions, mexcPositions, filter, onFilterChange, onCount }: Props) {
  const [data, setData] = useState<Record<TradingExchange, BitgetPositionsResponse>>({
    bitget: bitgetPositions,
    mexc: mexcPositions,
  });
  const [pending, setPending] = useState<Record<TradingExchange, PendingOrder[]>>({ bitget: [], mexc: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValue, setShowValue] = useState(false);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [tpslKey, setTpslKey] = useState<PosKey | null>(null);
  const [savingTpsl, setSavingTpsl] = useState(false);
  const [journalKey, setJournalKey] = useState<PosKey | null>(null);
  const [chart, setChart] = useState<{ ex: TradingExchange; symbol: string } | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelingAll, setCancelingAll] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const toggleSymbol = useCallback((symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }, []);
  const clientRef = useRef(createApiClient());

  useEffect(() => {
    try {
      setShowValue(localStorage.getItem(SHOW_VALUE_KEY) === '1');
    } catch {
      /* storage blocked — keep values hidden */
    }
  }, []);

  const toggleShowValue = useCallback(() => {
    setShowValue((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHOW_VALUE_KEY, next ? '1' : '0');
      } catch {
        /* storage blocked — the toggle still works for this visit */
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [bg, mx] = await Promise.allSettled([
      clientRef.current.fetchBitgetPositions(),
      clientRef.current.fetchMexcPositions(),
    ]);
    setData((prev) => ({
      bitget: bg.status === 'fulfilled' ? bg.value : prev.bitget,
      mexc: mx.status === 'fulfilled' ? mx.value : prev.mexc,
    }));
    const failed = [bg.status === 'rejected' ? 'Bitget' : null, mx.status === 'rejected' ? 'MEXC' : null].filter(Boolean);
    setError(failed.length > 0 ? `Không tải được vị thế từ ${failed.join(' và ')}. Thử lại sau.` : null);
    setLoading(false);
  }, []);

  // Resting limit orders of both exchanges. Non-fatal: a failure keeps that exchange's last list.
  const refreshPending = useCallback(async () => {
    const [bg, mx] = await Promise.allSettled([
      clientRef.current.fetchBitgetPendingOrders(),
      clientRef.current.fetchMexcPendingOrders(),
    ]);
    setPending((prev) => ({
      bitget: bg.status === 'fulfilled' ? bg.value.orders : prev.bitget,
      mexc: mx.status === 'fulfilled' ? mx.value.orders : prev.mexc,
    }));
  }, []);

  useEffect(() => {
    void refreshPending();
    const id = setInterval(() => {
      void refresh();
      void refreshPending();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh, refreshPending]);

  const closePosition = useCallback(
    async (ex: TradingExchange, symbol: string, holdSide: HoldSide) => {
      if (!window.confirm(`Đóng vị thế ${holdSide.toUpperCase()} ${symbol} trên ${EXCHANGE_LABEL[ex]} theo giá market ngay bây giờ?`)) {
        return;
      }
      setClosingKey(rowKey(ex, symbol, holdSide));
      setError(null);
      try {
        if (ex === 'bitget') await clientRef.current.closeBitgetPosition(symbol, holdSide);
        else await clientRef.current.closeMexcPosition(symbol, holdSide);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Đóng lệnh thất bại. Thử lại sau.');
      } finally {
        setClosingKey(null);
      }
    },
    [refresh],
  );

  const saveTpsl = useCallback(
    async (key: PosKey, input: { takeProfitPrice: number | null; stopLossPrice: number | null }) => {
      setSavingTpsl(true);
      setError(null);
      try {
        const body = { symbol: key.symbol, holdSide: key.holdSide, ...input };
        if (key.ex === 'bitget') await clientRef.current.setBitgetTpsl(body);
        else await clientRef.current.setMexcTpsl(body);
        setTpslKey(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Đặt TP/SL thất bại. Thử lại sau.');
      } finally {
        setSavingTpsl(false);
      }
    },
    [refresh],
  );

  const cancelOne = useCallback(async ({ ex, o }: PendingRow) => {
    if (ex === 'bitget') await clientRef.current.cancelBitgetOrder(o.symbol, o.orderId);
    else await clientRef.current.cancelMexcOrder(o.symbol, o.orderId);
  }, []);

  const cancelPending = useCallback(
    async (row: PendingRow) => {
      const { ex, o } = row;
      if (!window.confirm(`Huỷ lệnh chờ ${o.holdSide.toUpperCase()} ${o.symbol} @ ${fmtPrice(o.price)} trên ${EXCHANGE_LABEL[ex]}?`)) {
        return;
      }
      setCancelingId(pendingKey(ex, o.orderId));
      setError(null);
      try {
        await cancelOne(row);
        await refreshPending();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Huỷ lệnh chờ thất bại. Thử lại sau.');
      } finally {
        setCancelingId(null);
      }
    },
    [cancelOne, refreshPending],
  );

  const shownExchanges = useMemo(() => exchangesOf(filter), [filter]);

  const pendingRows = useMemo<PendingRow[]>(
    () => shownExchanges.flatMap((ex) => pending[ex].map((o) => ({ ex, o }))),
    [shownExchanges, pending],
  );

  // "Huỷ tất cả" cancels exactly the pending rows the filter shows. Best-effort:
  // one failure is reported but the rest still run.
  const cancelAllPending = useCallback(async () => {
    const rows = pendingRows;
    if (rows.length === 0) return;
    if (!window.confirm(`Huỷ tất cả ${rows.length} lệnh chờ (limit) trên ${describeByExchange(rows)}?`)) {
      return;
    }
    setCancelingAll(true);
    setError(null);
    let failed = 0;
    for (const row of rows) {
      try {
        await cancelOne(row);
      } catch {
        failed += 1;
      }
    }
    await refreshPending();
    if (failed > 0) setError(`Huỷ ${failed}/${rows.length} lệnh chờ thất bại. Thử lại sau.`);
    setCancelingAll(false);
  }, [pendingRows, cancelOne, refreshPending]);

  // Live prices per exchange (each exchange's own public WS). BTC rides on the Bitget socket for its tile.
  const bgLive = useBitgetLivePrices(
    useMemo(
      () => Array.from(new Set([BTC_SYMBOL, ...data.bitget.positions.map((p) => p.symbol), ...pending.bitget.map((o) => o.symbol)])),
      [data.bitget.positions, pending.bitget],
    ),
  );
  const mxLive = useMexcLivePrices(
    useMemo(
      () => Array.from(new Set([...data.mexc.positions.map((p) => p.symbol), ...pending.mexc.map((o) => o.symbol)])),
      [data.mexc.positions, pending.mexc],
    ),
  );
  const pricesOf = useCallback((ex: TradingExchange) => (ex === 'bitget' ? bgLive.prices : mxLive.prices), [bgLive.prices, mxLive.prices]);

  // Recompute uPnL / ROE / notional from the live price between the 15s refreshes, same as /bitget.
  const rows = useMemo<Row[]>(
    () =>
      shownExchanges
        .flatMap((ex) =>
          data[ex].positions.map((p): Row => {
            const px = pricesOf(ex)[p.symbol];
            if (px == null || !Number.isFinite(px)) return { ex, p };
            const dir = p.holdSide === 'long' ? 1 : -1;
            const unrealizedPnlUsd = (px - p.entryPrice) * p.size * dir;
            return {
              ex,
              p: {
                ...p,
                markPrice: px,
                notionalUsd: p.size * px,
                unrealizedPnlUsd,
                roePct: p.marginUsd > 0 ? (unrealizedPnlUsd / p.marginUsd) * 100 : p.roePct,
              },
            };
          }),
        )
        // Biggest winners first, across both exchanges.
        .sort((a, b) => b.p.roePct - a.p.roePct),
    [shownExchanges, data, pricesOf],
  );

  useEffect(() => {
    onCount?.(rows.length);
  }, [rows.length, onCount]);

  const visibleRows = useMemo(() => {
    if (selectedSymbols.size === 0) return rows;
    return rows.filter((r) => matchesSymbolSelection(r.p.symbol, selectedSymbols));
  }, [rows, selectedSymbols]);

  const availableSymbols = useMemo(() => Array.from(new Set(rows.map((r) => r.p.symbol))).sort(), [rows]);

  // Tiles: account totals of the exchanges the filter keeps (coin filter does not narrow them).
  const configuredExchanges = shownExchanges.filter((ex) => data[ex].configured);
  const missingExchanges = shownExchanges.filter((ex) => !data[ex].configured);
  const totalUnrealizedPnlUsd = rows.reduce((sum, r) => sum + r.p.unrealizedPnlUsd, 0);
  const totalMarginUsd = rows.reduce((sum, r) => sum + r.p.marginUsd, 0);
  // Equity only adds up when every kept exchange reported it.
  const equityKnown =
    configuredExchanges.length > 0 &&
    configuredExchanges.every((ex) => data[ex].accountEquityUsd != null && Number.isFinite(data[ex].accountEquityUsd));
  const accountEquityUsd = equityKnown ? configuredExchanges.reduce((sum, ex) => sum + (data[ex].accountEquityUsd ?? 0), 0) : null;
  const initialCapitalUsd = configuredExchanges.reduce((sum, ex) => sum + data[ex].initialCapitalUsd, 0);
  const equityChangePct =
    accountEquityUsd != null && initialCapitalUsd > 0 ? ((accountEquityUsd - initialCapitalUsd) / initialCapitalUsd) * 100 : null;
  // Vốn + PnL đã chốt: equity with the snapshot's floating PnL taken back out.
  const snapshotUnrealizedPnlUsd = configuredExchanges.reduce((sum, ex) => sum + data[ex].totalUnrealizedPnlUsd, 0);
  const settledBalanceUsd = accountEquityUsd != null ? accountEquityUsd - snapshotUnrealizedPnlUsd : null;
  const pnlPctOfBalance =
    settledBalanceUsd != null && settledBalanceUsd > 0 ? (totalUnrealizedPnlUsd / settledBalanceUsd) * 100 : null;

  // Live position behind the open TP/SL dialog; the dialog closes if the position disappears.
  const findRow = useCallback(
    (key: PosKey | null) => (key ? rows.find((r) => r.ex === key.ex && r.p.symbol === key.symbol && r.p.holdSide === key.holdSide) ?? null : null),
    [rows],
  );
  const tpslRow = useMemo(() => findRow(tpslKey), [findRow, tpslKey]);

  // The journal stays readable on the last-known position if the trade closes while it is open.
  const lastJournalRow = useRef<Row | null>(null);
  const journalRow = useMemo(() => {
    if (!journalKey) return null;
    const live = findRow(journalKey);
    if (live) lastJournalRow.current = live;
    return live ?? lastJournalRow.current;
  }, [journalKey, findRow]);

  const live = shownExchanges.some((ex) => (ex === 'bitget' ? bgLive.live : mxLive.live));
  const busy = cancelingId !== null || cancelingAll;
  const JournalDrawer = journalRow?.ex === 'mexc' ? MexcJournalDrawer : BitgetJournalDrawer;
  const TpslDialog = tpslRow?.ex === 'mexc' ? MexcTpslDialog : BitgetTpslDialog;
  const ChartDialog = chart?.ex === 'mexc' ? MexcSetupChartDialog : BitgetSetupChartDialog;

  return (
    <div className="bg-panel">
      <div className="bg-head">
        <div>
          <ExchangeFilterBar value={filter} onChange={onFilterChange} />
          <p className="bg-sub">
            <span
              className={`bg-live ${live ? 'bg-live--on' : ''}`}
              title={`Giá realtime · Bitget ${bgLive.live ? 'on' : 'off'} · MEXC ${mxLive.live ? 'on' : 'off'}`}
            >
              <span className="bg-live-dot" />
              {live ? 'LIVE' : 'offline'}
            </span>
            {loading ? ' · đang tải…' : ''}
          </p>
        </div>
        <div className="bg-head-actions">
          {configuredExchanges.length > 0 && (
            <button
              type="button"
              className="bg-toggle-value"
              onClick={toggleShowValue}
              aria-pressed={showValue}
              title="Ẩn/hiện số dư tài khoản và giá trị PnL"
            >
              <EyeIcon off={showValue} />
              {showValue ? 'Ẩn value' : 'Hiện value'}
            </button>
          )}
          <button
            className="bg-refresh"
            onClick={() => {
              void refresh();
              void refreshPending();
            }}
            disabled={loading}
          >
            ↻ Làm mới
          </button>
        </div>
      </div>

      {error && <div className="bg-alert bg-alert--error">{error}</div>}

      {missingExchanges.length > 0 && (
        <div className={styles.alertList}>
          {missingExchanges.map((ex) => (
            <div key={ex} className="bg-alert">
              <ExTag ex={ex} /> Chưa cấu hình {EXCHANGE_LABEL[ex]} API — không xem được vị thế của sàn này.
            </div>
          ))}
        </div>
      )}

      {configuredExchanges.length > 0 && (
        <>
          <div className="bg-tiles">
            <div className="bg-tile">
              <span className="bg-tile-label">Số dư tài khoản</span>
              <span className="bg-tile-value">
                {showValue ? fmtUsdPlain(accountEquityUsd) : <span className="bg-tile-hidden">••••••</span>}
              </span>
              <span className={`bg-tile-change ${pnlClass(equityChangePct ?? 0)}`}>
                {fmtPct(equityChangePct)}{' '}
                <span className="bg-tile-change-note">so với vốn {fmtUsdPlain(initialCapitalUsd)}</span>
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Tổng ký quỹ</span>
              <span className="bg-tile-value">{fmtUsdPlain(totalMarginUsd)}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">PnL chưa thực hiện</span>
              <span className={`bg-tile-value ${pnlClass(totalUnrealizedPnlUsd)}`}>
                {showValue ? fmtUsd(totalUnrealizedPnlUsd) : <span className="bg-tile-hidden">••••••</span>}
              </span>
              <span className={`bg-tile-change ${pnlClass(pnlPctOfBalance ?? 0)}`}>
                {fmtPct(pnlPctOfBalance)}{' '}
                <span className="bg-tile-change-note">
                  so với vốn + đã chốt{showValue ? ` ${fmtUsdPlain(settledBalanceUsd)}` : ''}
                </span>
              </span>
            </div>
            <BtcPriceTile priceUsd={bgLive.prices[BTC_SYMBOL] ?? null} />
          </div>

          {pendingRows.length > 0 && (
            <div className="bg-pending">
              <div className="bg-pending-head">
                <h3 className="bg-pending-title">Lệnh chờ (limit)</h3>
                <span className="bg-pending-hint">Chưa khớp · sàn tự mở vị thế khi giá chạm mức · bấm Huỷ để gỡ</span>
                <button
                  type="button"
                  className="bg-cancel-btn bg-cancel-all-btn"
                  onClick={() => void cancelAllPending()}
                  disabled={busy}
                  title={`Huỷ tất cả lệnh chờ đang hiện: ${describeByExchange(pendingRows)}`}
                >
                  {cancelingAll ? 'Đang huỷ…' : 'Huỷ tất cả'}
                </button>
              </div>
              <div className="bg-table-wrap">
                <table className="bg-table">
                  <thead>
                    <tr>
                      <th className={styles.exCol}>Sàn</th>
                      <th>Symbol</th>
                      <th>Hướng</th>
                      <th className="bg-num">Giá limit</th>
                      <th className="bg-num" title="Khoảng cách từ giá hiện tại tới giá limit">
                        Khoảng cách
                      </th>
                      <th className="bg-num">Đòn bẩy</th>
                      <th className="bg-num">Size</th>
                      <th className="bg-num">Giá trị</th>
                      <th className="bg-num">Đặt lúc</th>
                      <th className="bg-num">Huỷ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRows.map((row) => {
                      const { ex, o } = row;
                      const px = pricesOf(ex)[o.symbol];
                      const dist = px != null && Number.isFinite(px) && px > 0 ? ((o.price - px) / px) * 100 : null;
                      const isLong = o.holdSide === 'long';
                      return (
                        <tr key={pendingKey(ex, o.orderId)}>
                          <td className={styles.exCol}>
                            <ExTag ex={ex} />
                          </td>
                          <td className="bg-symbol">{o.symbol}</td>
                          <td>
                            <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>{isLong ? 'LONG' : 'SHORT'}</span>
                          </td>
                          <td className="bg-num">{fmtPrice(o.price)}</td>
                          <td className="bg-num">{dist == null ? '—' : fmtPct(dist)}</td>
                          <td className="bg-num">{o.leverage > 0 ? `${o.leverage}×` : '—'}</td>
                          <td className="bg-num">{fmtQty(o.size)}</td>
                          <td className="bg-num">{fmtUsdPlain(o.notionalUsd)}</td>
                          <td className="bg-num bg-time">{fmtTime(o.createdAt)}</td>
                          <td className="bg-num">
                            <button
                              type="button"
                              className="bg-cancel-btn"
                              onClick={() => void cancelPending(row)}
                              disabled={busy}
                              title={`Huỷ lệnh chờ này trên ${EXCHANGE_LABEL[ex]}`}
                            >
                              {cancelingId === pendingKey(ex, o.orderId) ? '…' : 'Huỷ'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="bg-alert">Không có vị thế nào đang mở.</div>
          ) : (
            <>
              <div className="bg-table-toolbar">
                <div className="bg-toolbar-filter pf-coin-filter">
                  <span className="bg-toolbar-label">Lọc coin:</span>
                  <SymbolChipFilter
                    symbols={availableSymbols}
                    selected={selectedSymbols}
                    onToggle={toggleSymbol}
                    count={visibleRows.length}
                  />
                  {selectedSymbols.size > 0 && (
                    <button type="button" className="bg-toolbar-clear" onClick={() => setSelectedSymbols(new Set())} title="Xoá bộ lọc">
                      ✕ Xoá lọc
                    </button>
                  )}
                </div>
              </div>
              {visibleRows.length === 0 ? (
                <div className="bg-alert">Không có vị thế nào khớp bộ lọc coin.</div>
              ) : (
                <div className="bg-table-wrap">
                  <table className="bg-table">
                    <thead>
                      <tr>
                        <th className={styles.exCol}>Sàn</th>
                        <th>Symbol</th>
                        <th className="bg-num">Đòn bẩy</th>
                        <th className="bg-num">Size</th>
                        <th className="bg-num">Giá vào</th>
                        <th className="bg-num">Giá hiện tại</th>
                        <th className="bg-num">Hoà vốn</th>
                        <th className="bg-num">Thanh lý</th>
                        <th className="bg-num">Ký quỹ</th>
                        <th className="bg-num">Giá trị</th>
                        <th className="bg-num">PnL {showValue ? '(uPnL)' : '(ROE)'}</th>
                        <th className="bg-num">Nhật ký</th>
                        <th className="bg-num" title="TP/SL đặt trên sàn — sàn tự đóng lệnh khi chạm mức">
                          TP / SL
                        </th>
                        <th className="bg-num">Đóng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(({ ex, p }) => {
                        const key = rowKey(ex, p.symbol, p.holdSide);
                        const posKey = { ex, symbol: p.symbol, holdSide: p.holdSide };
                        return (
                          <PositionRow
                            key={key}
                            ex={ex}
                            p={p}
                            showValue={showValue}
                            closing={closingKey === key}
                            disabled={closingKey !== null}
                            onClose={() => void closePosition(ex, p.symbol, p.holdSide)}
                            onJournal={() => setJournalKey(posKey)}
                            onChart={() => setChart({ ex, symbol: p.symbol })}
                            onTpsl={() => setTpslKey(posKey)}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {journalRow && (
        <JournalDrawer
          key={`${journalRow.ex}-${tradeKeyOf(journalRow.p)}`}
          target={{
            tradeKey: tradeKeyOf(journalRow.p),
            symbol: journalRow.p.symbol,
            holdSide: journalRow.p.holdSide,
            status: 'open',
            entryPrice: journalRow.p.entryPrice,
            markPrice: journalRow.p.markPrice,
            roePct: journalRow.p.roePct,
            openedAt: journalRow.p.openedAt,
            live: journalRow.p,
          }}
          onClose={() => setJournalKey(null)}
        />
      )}

      {chart && <ChartDialog symbol={chart.symbol} onClose={() => setChart(null)} />}

      {tpslRow && (
        <TpslDialog
          key={rowKey(tpslRow.ex, tpslRow.p.symbol, tpslRow.p.holdSide)}
          position={tpslRow.p}
          saving={savingTpsl}
          onSave={(input) => void saveTpsl({ ex: tpslRow.ex, symbol: tpslRow.p.symbol, holdSide: tpslRow.p.holdSide }, input)}
          onClose={() => setTpslKey(null)}
        />
      )}
    </div>
  );
}

// Monochrome eye / eye-off icon — inherits text color via currentColor.
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

type PositionRowProps = {
  ex: TradingExchange;
  p: Position;
  showValue: boolean;
  closing: boolean;
  disabled: boolean;
  onClose: () => void;
  onJournal: () => void;
  onChart: () => void;
  onTpsl: () => void;
};

function PositionRow({ ex, p, showValue, closing, disabled, onClose, onJournal, onChart, onTpsl }: PositionRowProps) {
  const isLong = p.holdSide === 'long';
  // Flash the live-price cell green/red on each tick.
  const prevPrice = useRef(p.markPrice);
  const [flash, setFlash] = useState<'' | 'bg-tick--up' | 'bg-tick--down'>('');
  useEffect(() => {
    const prev = prevPrice.current;
    if (Number.isFinite(p.markPrice) && p.markPrice !== prev) {
      setFlash(p.markPrice > prev ? 'bg-tick--up' : 'bg-tick--down');
      prevPrice.current = p.markPrice;
      const id = setTimeout(() => setFlash(''), 500);
      return () => clearTimeout(id);
    }
  }, [p.markPrice]);

  return (
    <tr>
      <td className={styles.exCol}>
        <ExTag ex={ex} />
      </td>
      <td className="bg-symbol">
        <span className="bg-symbol-side">
          {p.symbol}
          <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>{isLong ? 'LONG' : 'SHORT'}</span>
          <button
            type="button"
            className="bg-chart-icon-btn"
            onClick={onChart}
            title="Xem chart (SonicR + S/R Channel + RSI)"
            aria-label={`Xem chart ${p.symbol}`}
          >
            <ChartIcon />
          </button>
        </span>
      </td>
      <td className="bg-num">
        {p.leverage ? `${p.leverage}×` : '—'}
        <span className="bg-margin-mode">{p.marginMode === 'crossed' ? 'cross' : p.marginMode}</span>
      </td>
      <td className="bg-num">{fmtQty(p.size)}</td>
      <td className="bg-num">{fmtPrice(p.entryPrice)}</td>
      <td className={`bg-num bg-mark ${flash}`}>{fmtPrice(p.markPrice)}</td>
      <td className="bg-num">{fmtPrice(p.breakEvenPrice)}</td>
      <td className="bg-num bg-liq">{fmtPrice(p.liquidationPrice)}</td>
      <td className="bg-num">{fmtUsdPlain(p.marginUsd)}</td>
      <td className="bg-num">{fmtUsdPlain(p.notionalUsd)}</td>
      <td className={`bg-num bg-pnl-cell ${pnlClass(p.unrealizedPnlUsd)}`}>
        {showValue && <span className="bg-pnl-usd">{fmtUsd(p.unrealizedPnlUsd)}</span>}
        <span className="bg-pnl-pct">{fmtPct(p.roePct)}</span>
      </td>
      <td className="bg-num">
        <button type="button" className="bg-journal-btn" onClick={onJournal} title="Nhật ký theo dõi lệnh">
          📝
        </button>
      </td>
      <td className="bg-num">
        <button
          type="button"
          className="bg-tpsl-btn"
          onClick={onTpsl}
          title={`Đặt TP/SL trên ${EXCHANGE_LABEL[ex]} — sàn tự đóng lệnh khi chạm mức`}
        >
          <span className={`bg-tpsl-line ${p.takeProfitPrice != null ? 'bg-tpsl--tp' : 'bg-tpsl--unset'}`}>
            TP {fmtPrice(p.takeProfitPrice)}
          </span>
          <span className={`bg-tpsl-line ${p.stopLossPrice != null ? 'bg-tpsl--sl' : 'bg-tpsl--unset'}`}>
            SL {fmtPrice(p.stopLossPrice)}
          </span>
        </button>
      </td>
      <td className="bg-num">
        <button type="button" className="bg-close-btn" onClick={onClose} disabled={disabled}>
          {closing ? '…' : 'Đóng'}
        </button>
      </td>
    </tr>
  );
}
