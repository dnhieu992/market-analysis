'use client';

import { useEffect, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { SpotTradeCard as SpotTrade } from '@web/shared/api/types';

import styles from './tracking.module.css';

const api = createApiClient();

export const fmtQty = (n: number) => Number(n.toPrecision(8)).toLocaleString('en-US', { maximumFractionDigits: 8 });
export const fmtUsd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** ISO → value of a <input type="datetime-local"> in Vietnam time. */
function toLocalInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return d.toISOString().slice(0, 16);
}
const fromLocalInput = (v: string) => new Date(`${v}:00+07:00`).toISOString();

let portfolioCache: Promise<Array<{ id: string; name: string }>> | null = null;

const STATUS: Record<SpotTrade['status'], string> = {
  PENDING: 'Chờ xác nhận',
  CONFIRMING: 'Đang ghi…',
  CONFIRMED: '✓ Đã ghi vào portfolio',
  CANCELLED: 'Đã huỷ',
};

/**
 * A buy/sell the Spot Analytic chat wants to log. Nothing reaches the portfolio until
 * "Xác nhận"; "Sửa" lets the trader fix price / amount / time / portfolio first.
 */
export function SpotTradeCardView({ trade, onChange }: { trade: SpotTrade; onChange: (t: SpotTrade) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState(String(trade.price));
  const [amount, setAmount] = useState(String(trade.amount));
  const [when, setWhen] = useState(toLocalInput(trade.transactedAt));
  const [portfolioId, setPortfolioId] = useState(trade.portfolioId);
  const [portfolios, setPortfolios] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!editing) return;
    portfolioCache ??= api.fetchSpotPortfolios().catch(() => {
      portfolioCache = null;
      return [];
    });
    void portfolioCache.then(setPortfolios);
  }, [editing]);

  const sell = trade.side === 'sell';
  const pending = trade.status === 'PENDING';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const edit = editing
        ? { price: Number(price), amount: Number(amount), transactedAt: fromLocalInput(when), portfolioId }
        : {};
      const saved = await api.confirmSpotTrade(trade.id, edit);
      onChange({ ...saved, portfolioName: portfolios.find((p) => p.id === saved.portfolioId)?.name ?? trade.portfolioName });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      onChange({ ...(await api.cancelSpotTrade(trade.id)), portfolioName: trade.portfolioName });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.card} ${sell ? styles.cardShort : ''} ${pending ? '' : styles.cardDone}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardSymbol}>{sell ? 'BÁN' : 'MUA'} {trade.symbol}</span>
        <span className={styles.cardType}>{trade.portfolioName ?? '—'}</span>
        <span className={styles.spacer} />
        <span className={styles.hint}>{STATUS[trade.status]}</span>
      </div>
      <div className={styles.levels}>
        <div className={styles.level}><span className={styles.levelLabel}>Số lượng</span><span className={styles.levelValue}>{fmtQty(trade.amount)}</span></div>
        <div className={styles.level}><span className={styles.levelLabel}>Giá</span><span className={styles.levelValue}>{fmtQty(trade.price)}</span></div>
        <div className={styles.level}><span className={styles.levelLabel}>Tổng (USDT)</span><span className={styles.levelValue}>{fmtUsd(trade.amount * trade.price)}</span></div>
        <div className={styles.level}><span className={styles.levelLabel}>Thời gian</span><span className={styles.levelValue}>{fmtWhen(trade.transactedAt)}</span></div>
      </div>
      {trade.note && <p className={styles.meta}>{trade.note}</p>}

      {pending && editing && (
        <div className={styles.inlineForm}>
          <label className={styles.hint}>Số lượng <input className={`${styles.input} ${styles.num}`} type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className={styles.hint}>Giá <input className={`${styles.input} ${styles.num}`} type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className={styles.hint}>Lúc <input className={styles.input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
          <label className={styles.hint}>
            Portfolio{' '}
            <select className={styles.select} value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
              {(portfolios.length ? portfolios : [{ id: trade.portfolioId, name: trade.portfolioName ?? '—' }]).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {pending && (
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void confirm()}>
            {busy ? '…' : editing ? 'Lưu & xác nhận' : 'Xác nhận'}
          </button>
          <button type="button" className={styles.btn} disabled={busy} onClick={() => setEditing((v) => !v)}>{editing ? 'Thôi sửa' : 'Sửa'}</button>
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => void cancel()}>Huỷ</button>
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
