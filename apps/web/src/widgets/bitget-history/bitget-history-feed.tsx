'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { BitgetClosedTrade, BitgetHistoryResponse } from '@web/shared/api/types';

const REFRESH_MS = 60_000;

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

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  initial: BitgetHistoryResponse;
};

export function BitgetHistoryFeed({ initial }: Props) {
  const [data, setData] = useState<BitgetHistoryResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef(createApiClient());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await clientRef.current.fetchBitgetHistory({ limit: 200 });
      setData(next);
      setError(null);
    } catch {
      setError('Không tải được lịch sử từ máy chủ. Thử lại sau.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { configured, trades, summary, fetchedAt } = data;

  return (
    <div className="page">
      <div className="bg-head">
        <div>
          <h1>Bitget · Lịch sử lệnh &amp; PnL</h1>
          <p className="bg-sub">
            Vị thế đã đóng (USDT futures) · đồng bộ {relTime(fetchedAt)}
            {loading ? ' · đang tải…' : ''}
          </p>
        </div>
        <button className="bg-refresh" onClick={refresh} disabled={loading}>
          ↻ Làm mới
        </button>
      </div>

      {error && <div className="bg-alert bg-alert--error">{error}</div>}

      {!configured && trades.length === 0 ? (
        <div className="bg-alert">
          Chưa cấu hình Bitget API. Thêm <code>BITGET_API_KEY</code>, <code>BITGET_API_SECRET</code>,{' '}
          <code>BITGET_API_PASSPHRASE</code> vào <code>.env</code> để worker đồng bộ lịch sử lệnh.
        </div>
      ) : (
        <>
          <div className="bg-tiles">
            <div className="bg-tile">
              <span className="bg-tile-label">Tổng PnL ròng</span>
              <span className={`bg-tile-value ${pnlClass(summary.totalNetProfit)}`}>
                {fmtUsd(summary.totalNetProfit)}
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Win rate</span>
              <span className="bg-tile-value">
                {summary.winRatePct.toFixed(1)}%
                <span className="bg-tile-sub">
                  {summary.wins}W · {summary.losses}L
                </span>
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Số lệnh</span>
              <span className="bg-tile-value">{summary.trades}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">TB / lệnh</span>
              <span className={`bg-tile-value ${pnlClass(summary.avgNetProfit)}`}>
                {fmtUsd(summary.avgNetProfit)}
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Lãi lớn nhất</span>
              <span className="bg-tile-value bg-pnl--up">{fmtUsd(summary.bestNetProfit)}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Lỗ lớn nhất</span>
              <span className="bg-tile-value bg-pnl--down">{fmtUsd(summary.worstNetProfit)}</span>
            </div>
          </div>

          {trades.length === 0 ? (
            <div className="bg-alert">
              Chưa có lệnh nào được đồng bộ. Worker sẽ tự kéo lịch sử ~90 ngày trong vài phút tới.
            </div>
          ) : (
            <div className="bg-table-wrap">
              <table className="bg-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Hướng</th>
                    <th className="bg-num">Size</th>
                    <th className="bg-num">Giá vào</th>
                    <th className="bg-num">Giá đóng</th>
                    <th className="bg-num">Phí</th>
                    <th className="bg-num">Funding</th>
                    <th className="bg-num">PnL ròng</th>
                    <th className="bg-num">Mở</th>
                    <th className="bg-num">Đóng</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <TradeRow key={t.positionId} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TradeRow({ t }: { t: BitgetClosedTrade }) {
  const isLong = t.holdSide === 'long';
  return (
    <tr>
      <td className="bg-symbol">{t.symbol}</td>
      <td>
        <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
          {isLong ? 'LONG' : 'SHORT'}
        </span>
      </td>
      <td className="bg-num">{fmtQty(t.size)}</td>
      <td className="bg-num">{fmtPrice(t.openAvgPrice)}</td>
      <td className="bg-num">{fmtPrice(t.closeAvgPrice)}</td>
      <td className="bg-num">{fmtUsdPlain(t.feesUsd)}</td>
      <td className="bg-num">{fmtUsdPlain(t.totalFunding)}</td>
      <td className={`bg-num bg-pnl-cell ${pnlClass(t.netProfit)}`}>
        <span className="bg-pnl-usd">{fmtUsd(t.netProfit)}</span>
        <span className="bg-pnl-pct">{fmtPct(t.netProfitPct)}</span>
      </td>
      <td className="bg-num bg-time">{fmtDateTime(t.openedAt)}</td>
      <td className="bg-num bg-time">{fmtDateTime(t.closedAt)}</td>
    </tr>
  );
}
