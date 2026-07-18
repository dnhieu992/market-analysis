'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { BitgetPosition, BitgetPositionsResponse } from '@web/shared/api/types';

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

function relTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 5) return 'vừa xong';
  if (secs < 60) return `${secs}s trước`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} phút trước`;
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

type Props = {
  initial: BitgetPositionsResponse;
  /** When rendered inside the merged Bitget tabs, drop the outer page chrome + title. */
  embedded?: boolean;
};

export function BitgetPositionsFeed({ initial, embedded = false }: Props) {
  const [data, setData] = useState<BitgetPositionsResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PnL USD amounts are hidden by default (privacy) — only ROE% shows. Toggle
  // persists in localStorage so the choice sticks across reloads.
  const [showValue, setShowValue] = useState(false);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const clientRef = useRef(createApiClient());

  useEffect(() => {
    setShowValue(localStorage.getItem(SHOW_VALUE_KEY) === '1');
  }, []);

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

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { configured, positions: rawPositions, fetchedAt } = data;

  // Live mark prices straight from Bitget's public WS; recompute uPnL/ROE/notional
  // client-side so the table tracks price between the 15s authoritative refreshes.
  const { prices: livePrices, live } = useBitgetLivePrices(
    useMemo(() => rawPositions.map((p) => p.symbol), [rawPositions]),
  );

  const positions = useMemo(
    () =>
      rawPositions.map((p) => {
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
      }),
    [rawPositions, livePrices],
  );

  const totalUnrealizedPnlUsd = useMemo(
    () => positions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0),
    [positions],
  );
  const totalMarginUsd = useMemo(() => positions.reduce((sum, p) => sum + p.marginUsd, 0), [positions]);
  const totalRoePct = totalMarginUsd > 0 ? (totalUnrealizedPnlUsd / totalMarginUsd) * 100 : 0;

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
            {' · '}USDT futures · đồng bộ {relTime(fetchedAt)}
            {loading ? ' · đang tải…' : ''}
          </p>
        </div>
        <button className="bg-refresh" onClick={refresh} disabled={loading}>
          ↻ Làm mới
        </button>
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
              <span className="bg-tile-label">Vị thế đang mở</span>
              <span className="bg-tile-value">{positions.length}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Tổng ký quỹ</span>
              <span className="bg-tile-value">{fmtUsdPlain(totalMarginUsd)}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">PnL chưa thực hiện</span>
              <span className={`bg-tile-value ${pnlClass(totalUnrealizedPnlUsd)}`}>
                {showValue ? fmtUsd(totalUnrealizedPnlUsd) : fmtPct(totalRoePct)}
              </span>
            </div>
          </div>

          {positions.length === 0 ? (
            <div className="bg-alert">Không có vị thế nào đang mở.</div>
          ) : (
            <>
              <div className="bg-table-toolbar">
                <button
                  type="button"
                  className="bg-toggle-value"
                  onClick={toggleShowValue}
                  aria-pressed={showValue}
                >
                  {showValue ? '🙈 Ẩn value' : '👁 Hiện value'}
                </button>
              </div>
              <div className="bg-table-wrap">
                <table className="bg-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Hướng</th>
                      <th className="bg-num">Đòn bẩy</th>
                      <th className="bg-num">Size</th>
                      <th className="bg-num">Giá vào</th>
                      <th className="bg-num">Giá hiện tại</th>
                      <th className="bg-num">Hoà vốn</th>
                      <th className="bg-num">Thanh lý</th>
                      <th className="bg-num">Ký quỹ</th>
                      <th className="bg-num">Giá trị</th>
                      <th className="bg-num">PnL {showValue ? '(uPnL)' : '(ROE)'}</th>
                      <th className="bg-num">Đóng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <PositionRow
                        key={`${p.symbol}-${p.holdSide}`}
                        p={p}
                        showValue={showValue}
                        closing={closingKey === `${p.symbol}-${p.holdSide}`}
                        disabled={closingKey !== null}
                        onClose={closePosition}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

type PositionRowProps = {
  p: BitgetPosition;
  showValue: boolean;
  closing: boolean;
  disabled: boolean;
  onClose: (symbol: string, holdSide: 'long' | 'short') => void;
};

function PositionRow({ p, showValue, closing, disabled, onClose }: PositionRowProps) {
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
      <td className="bg-symbol">{p.symbol}</td>
      <td>
        <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
          {isLong ? 'LONG' : 'SHORT'}
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
