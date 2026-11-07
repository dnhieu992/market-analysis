'use client';

import { useEffect, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { SpotHistory } from '@web/shared/api/types';

import { fmtQty, fmtUsd, fmtWhen } from './spot-trade-card';
import styles from './tracking.module.css';

/**
 * A coin's buys / sells logged from this page (chat cards the trader confirmed) plus what is held
 * now in each portfolio. Holdings and average cost are the portfolio's real numbers, so they also
 * include trades typed on the portfolio page — those trades are not listed here.
 */
export function SpotHistoryDialog({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [data, setData] = useState<SpotHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    createApiClient().fetchSpotHistory(symbol).then(setData).catch((e: Error) => setError(e.message));
    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { price?: string } | null) => j?.price && setPrice(Number(j.price)))
      .catch(() => {});
  }, [symbol]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const held = data?.positions.filter((p) => p.amount > 0) ?? [];
  const totalAmt = held.reduce((a, p) => a + p.amount, 0);
  const totalCost = held.reduce((a, p) => a + p.totalCost, 0);
  const avg = totalAmt > 0 ? totalCost / totalAmt : 0;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Lịch sử {symbol}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body">
          {error && <p className={styles.error}>{error}</p>}
          {!data && !error && <p className={styles.hint}>Đang tải…</p>}
          {data && (
            <>
              <h3 className={styles.historyTitle}>Đang nắm giữ (số thật của portfolio)</h3>
              {held.length === 0 ? (
                <p className={styles.hint}>Không còn giữ {symbol} trong portfolio nào.</p>
              ) : (
                <div className={styles.historyTableWrap}>
                  <table className={styles.historyTable}>
                    <thead>
                      <tr><th>Portfolio</th><th>Số lượng</th><th>Giá TB</th><th>Vốn (USDT)</th><th>Lãi/lỗ</th></tr>
                    </thead>
                    <tbody>
                      {held.map((p) => {
                        const pnl = price && p.avgCost > 0 ? (price / p.avgCost - 1) * 100 : null;
                        return (
                          <tr key={p.portfolioId}>
                            <td>{p.portfolioName}</td>
                            <td>{fmtQty(p.amount)}</td>
                            <td>{fmtQty(p.avgCost)}</td>
                            <td>{fmtUsd(p.totalCost)}</td>
                            <td className={pnl == null ? '' : pnl >= 0 ? styles.up : styles.down}>{pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`}</td>
                          </tr>
                        );
                      })}
                      {held.length > 1 && (
                        <tr className={styles.historyTotal}>
                          <td>Tổng</td><td>{fmtQty(totalAmt)}</td><td>{fmtQty(avg)}</td><td>{fmtUsd(totalCost)}</td>
                          <td>{price && avg > 0 ? `${price >= avg ? '+' : ''}${((price / avg - 1) * 100).toFixed(1)}%` : '—'}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {price != null && <p className={styles.hint}>Giá hiện tại: {fmtQty(price)}</p>}

              <h3 className={styles.historyTitle}>Lệnh ghi từ trang này</h3>
              {data.trades.length === 0 ? (
                <p className={styles.hint}>Chưa có lệnh nào ghi từ chat của trang này. Lệnh nhập ở trang Portfolio không hiện ở đây.</p>
              ) : (
                <ul className={styles.historyList}>
                  {data.trades.map((t) => (
                    <li key={t.id} className={t.removed ? styles.historyRemoved : ''}>
                      <span className={t.side === 'sell' ? styles.down : styles.up}>{t.side === 'sell' ? 'Bán' : 'Mua'}</span>{' '}
                      <strong>{fmtQty(t.amount)}</strong> {symbol} ở giá <strong>{fmtQty(t.price)}</strong> ({fmtUsd(t.value)} USDT) ngày {fmtWhen(t.transactedAt)} · {t.portfolioName}
                      {t.note && <span className={styles.hint}> · {t.note}</span>}
                      {t.removed && <span className={styles.hint}> · đã xoá bên Portfolio</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
