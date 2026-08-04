'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { BitgetPosition, BitgetPositionsResponse } from '@web/shared/api/types';

import { ChartIcon } from '../bitget/chart-icon';
import { SetupChartDialog } from '../bitget/setup-chart-dialog';
import { SymbolMultiSelect } from '../bitget/symbol-multi-select';

import { BitgetJournalDrawer, tradeKeyOf } from './bitget-journal-drawer';
import { TpslDialog } from './tpsl-dialog';
import { useBitgetLivePrices } from './use-bitget-live-prices';

const REFRESH_MS = 15_000;
const SHOW_VALUE_KEY = 'bitget:pnl-show-value';

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

type Props = {
  initial: BitgetPositionsResponse;
  /** When rendered inside the merged Bitget tabs, drop the outer page chrome + title. */
  embedded?: boolean;
  /** Reports how many positions are live, so the tab label can show the count. */
  onCount?: (count: number) => void;
};

export function BitgetPositionsFeed({ initial, embedded = false, onCount }: Props) {
  const [data, setData] = useState<BitgetPositionsResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PnL USD amounts are hidden by default (privacy) — only ROE% shows. Toggle
  // persists in localStorage so the choice sticks across reloads.
  const [showValue, setShowValue] = useState(false);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  // Which position's TP/SL dialog is open, and whether its save is in flight.
  const [tpslKey, setTpslKey] = useState<{ symbol: string; holdSide: 'long' | 'short' } | null>(null);
  const [savingTpsl, setSavingTpsl] = useState(false);
  // Which trade's journal drawer is open — stored as identity so it tracks the
  // live position object across the 15s refreshes (fresh price for new notes).
  const [journalKey, setJournalKey] = useState<{ symbol: string; holdSide: 'long' | 'short' } | null>(null);
  // Which coin's live chart dialog is open (icon button next to the symbol).
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  // Coin-name filter (empty = all coins), same UX as the History tab.
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const clientRef = useRef(createApiClient());

  useEffect(() => {
    setShowValue(localStorage.getItem(SHOW_VALUE_KEY) === '1');
  }, []);

  // Keep the tab label's count in step with each 15s refresh.
  useEffect(() => {
    onCount?.(data.positions.length);
  }, [data.positions.length, onCount]);

  const toggleShowValue = useCallback(() => {
    setShowValue((prev) => {
      const next = !prev;
      localStorage.setItem(SHOW_VALUE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await clientRef.current.fetchBitgetPositions();
      setData(next);
      setError(null);
    } catch {
      setError('Không tải được vị thế từ Bitget. Thử lại sau.');
    } finally {
      setLoading(false);
    }
  }, []);

  const closePosition = useCallback(
    async (symbol: string, holdSide: 'long' | 'short') => {
      const key = `${symbol}-${holdSide}`;
      if (
        !window.confirm(
          `Đóng vị thế ${holdSide.toUpperCase()} ${symbol} theo giá market ngay bây giờ?`,
        )
      ) {
        return;
      }
      setClosingKey(key);
      setError(null);
      try {
        await clientRef.current.closeBitgetPosition(symbol, holdSide);
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
    async (
      symbol: string,
      holdSide: 'long' | 'short',
      input: { takeProfitPrice: number | null; stopLossPrice: number | null },
    ) => {
      setSavingTpsl(true);
      setError(null);
      try {
        await clientRef.current.setBitgetTpsl({ symbol, holdSide, ...input });
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

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { configured, positions: rawPositions, accountEquityUsd, initialCapitalUsd, equityChangePct } = data;

  // Live mark prices straight from Bitget's public WS; recompute uPnL/ROE/notional
  // client-side so the table tracks price between the 15s authoritative refreshes.
  const { prices: livePrices, live } = useBitgetLivePrices(
    useMemo(() => rawPositions.map((p) => p.symbol), [rawPositions]),
  );

  const positions = useMemo(
    () =>
      rawPositions
        .map((p) => {
          const px = livePrices[p.symbol];
          if (px == null || !Number.isFinite(px)) return p;
          const dir = p.holdSide === 'long' ? 1 : -1;
          const unrealizedPnlUsd = (px - p.entryPrice) * p.size * dir;
          return {
            ...p,
            markPrice: px,
            notionalUsd: p.size * px,
            unrealizedPnlUsd,
            roePct: p.marginUsd > 0 ? (unrealizedPnlUsd / p.marginUsd) * 100 : p.roePct,
          };
        })
        // Sort by PnL % (ROE) descending — biggest winners first.
        .sort((a, b) => b.roePct - a.roePct),
    [rawPositions, livePrices],
  );

  // Distinct coin names currently open, for the filter dropdown.
  const availableSymbols = useMemo(
    () => Array.from(new Set(positions.map((p) => p.symbol))).sort(),
    [positions],
  );

  // Drop coins from the filter once they stop being open positions (closed by
  // TP/SL between refreshes) — otherwise the table stays stuck on an empty list.
  useEffect(() => {
    setSelectedSymbols((prev) => {
      if (prev.length === 0) return prev;
      const open = new Set(availableSymbols);
      const next = prev.filter((s) => open.has(s));
      return next.length === prev.length ? prev : next;
    });
  }, [availableSymbols]);

  // Rows the table shows. The tiles below stay on the unfiltered list — they are
  // account-level totals, so narrowing the coin filter must not distort them.
  const visiblePositions = useMemo(() => {
    if (selectedSymbols.length === 0) return positions;
    const set = new Set(selectedSymbols);
    return positions.filter((p) => set.has(p.symbol));
  }, [positions, selectedSymbols]);

  const totalUnrealizedPnlUsd = useMemo(
    () => positions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0),
    [positions],
  );
  const totalMarginUsd = useMemo(() => positions.reduce((sum, p) => sum + p.marginUsd, 0), [positions]);
  // Unrealized PnL as a % of total account equity (the "Số dư tài khoản" tile).
  const pnlPctOfEquity =
    accountEquityUsd != null && accountEquityUsd > 0
      ? (totalUnrealizedPnlUsd / accountEquityUsd) * 100
      : null;

  // The live position whose journal is open. Falls back to the last-known object
  // if the trade just closed, so the drawer stays readable while it's open.
  // Live position behind the open TP/SL dialog — tracked by identity so the
  // dialog's mark price stays current across refreshes, and closes itself if the
  // position disappears (closed on the exchange meanwhile).
  const tpslPosition = useMemo(() => {
    if (!tpslKey) return null;
    return (
      positions.find((p) => p.symbol === tpslKey.symbol && p.holdSide === tpslKey.holdSide) ?? null
    );
  }, [tpslKey, positions]);

  const lastJournalPos = useRef<BitgetPosition | null>(null);
  const journalPosition = useMemo(() => {
    if (!journalKey) return null;
    const live = positions.find(
      (p) => p.symbol === journalKey.symbol && p.holdSide === journalKey.holdSide,
    );
    if (live) lastJournalPos.current = live;
    return live ?? lastJournalPos.current;
  }, [journalKey, positions]);

  return (
    <div className={embedded ? 'bg-panel' : 'page'}>
      <div className="bg-head">
        <div>
          {!embedded && <h1>Bitget · Vị thế đang mở</h1>}
          <p className="bg-sub">
            <span className={`bg-live ${live ? 'bg-live--on' : ''}`}>
              <span className="bg-live-dot" />
              {live ? 'LIVE' : 'offline'}
            </span>
          </p>
        </div>
        <div className="bg-head-actions">
          {configured && (
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
          <button className="bg-refresh" onClick={refresh} disabled={loading}>
            ↻ Làm mới
          </button>
        </div>
      </div>

      {error && <div className="bg-alert bg-alert--error">{error}</div>}

      {!configured ? (
        <div className="bg-alert">
          Chưa cấu hình Bitget API. Thêm <code>BITGET_API_KEY</code>, <code>BITGET_API_SECRET</code>,{' '}
          <code>BITGET_API_PASSPHRASE</code> vào <code>.env</code> để xem vị thế.
        </div>
      ) : (
        <>
          <div className="bg-tiles">
            <div className="bg-tile">
              <span className="bg-tile-label">Số dư tài khoản</span>
              {/* The USD amount is hidden by default (privacy) and revealed by the
                  same "Hiện value" toggle as PnL. The % vs capital stays visible
                  either way — it is the number worth glancing at, and the balance
                  it hides behind is the trader's own call. */}
              <span className="bg-tile-value">
                {showValue ? fmtUsdPlain(accountEquityUsd) : <span className="bg-tile-hidden">••••••</span>}
              </span>
              <span className={`bg-tile-change ${pnlClass(equityChangePct ?? 0)}`}>
                {fmtPct(equityChangePct)}{' '}
                <span className="bg-tile-change-note">
                  so với vốn {fmtUsdPlain(initialCapitalUsd)}
                </span>
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Tổng ký quỹ</span>
              <span className="bg-tile-value">{fmtUsdPlain(totalMarginUsd)}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">PnL chưa thực hiện</span>
              <span className={`bg-tile-value ${pnlClass(totalUnrealizedPnlUsd)}`}>
                {showValue ? fmtUsd(totalUnrealizedPnlUsd) : fmtPct(pnlPctOfEquity)}
              </span>
            </div>
          </div>

          {positions.length === 0 ? (
            <div className="bg-alert">Không có vị thế nào đang mở.</div>
          ) : (
            <>
              <div className="bg-table-toolbar">
                <div className="bg-toolbar-filter">
                  <span className="bg-toolbar-label">Lọc coin:</span>
                  <SymbolMultiSelect
                    symbols={availableSymbols}
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
              </div>
              {visiblePositions.length === 0 ? (
                <div className="bg-alert">Không có vị thế nào khớp bộ lọc coin.</div>
              ) : (
              <div className="bg-table-wrap">
                <table className="bg-table">
                  <thead>
                    <tr>
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
                      <th className="bg-num" title="TP/SL đặt trên sàn — Bitget tự đóng lệnh khi chạm mức">
                        TP / SL
                      </th>
                      <th className="bg-num">Đóng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePositions.map((p) => (
                      <PositionRow
                        key={`${p.symbol}-${p.holdSide}`}
                        p={p}
                        showValue={showValue}
                        closing={closingKey === `${p.symbol}-${p.holdSide}`}
                        disabled={closingKey !== null}
                        onClose={closePosition}
                        onJournal={() => setJournalKey({ symbol: p.symbol, holdSide: p.holdSide })}
                        onChart={() => setChartSymbol(p.symbol)}
                        onTpsl={() => setTpslKey({ symbol: p.symbol, holdSide: p.holdSide })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </>
          )}
        </>
      )}

      {journalPosition && (
        <BitgetJournalDrawer
          key={tradeKeyOf(journalPosition)}
          target={{
            tradeKey: tradeKeyOf(journalPosition),
            symbol: journalPosition.symbol,
            holdSide: journalPosition.holdSide,
            status: 'open',
            entryPrice: journalPosition.entryPrice,
            markPrice: journalPosition.markPrice,
            roePct: journalPosition.roePct,
            openedAt: journalPosition.openedAt,
            live: journalPosition,
          }}
          onClose={() => setJournalKey(null)}
        />
      )}

      {chartSymbol && (
        <SetupChartDialog symbol={chartSymbol} onClose={() => setChartSymbol(null)} />
      )}

      {tpslPosition && (
        <TpslDialog
          key={`${tpslPosition.symbol}-${tpslPosition.holdSide}`}
          position={tpslPosition}
          saving={savingTpsl}
          onSave={(input) => void saveTpsl(tpslPosition.symbol, tpslPosition.holdSide, input)}
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
  p: BitgetPosition;
  showValue: boolean;
  closing: boolean;
  disabled: boolean;
  onClose: (symbol: string, holdSide: 'long' | 'short') => void;
  onJournal: () => void;
  onChart: () => void;
  onTpsl: () => void;
};

function PositionRow({ p, showValue, closing, disabled, onClose, onJournal, onChart, onTpsl }: PositionRowProps) {
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
      <td className="bg-symbol">
        <span className="bg-symbol-side">
          {p.symbol}
          <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
            {isLong ? 'LONG' : 'SHORT'}
          </span>
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
          title="Đặt TP/SL trên sàn — Bitget tự đóng lệnh khi chạm mức"
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
        <button
          type="button"
          className="bg-close-btn"
          onClick={() => onClose(p.symbol, p.holdSide)}
          disabled={disabled}
        >
          {closing ? '…' : 'Đóng'}
        </button>
      </td>
    </tr>
  );
}
