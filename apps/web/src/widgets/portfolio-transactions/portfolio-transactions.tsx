'use client';

import { useRef, useState, useTransition } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { CoinTransaction } from '@web/shared/api/types';

type PortfolioTransactionsProps = Readonly<{
  portfolioId: string;
  transactions: CoinTransaction[];
}>;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatExactPrice(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 10 }).format(value);
}

function toDateInputValue(dateStr: string): string {
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function EditTransactionModal({ tx, portfolioId, onClose, onSaved }: {
  tx: CoinTransaction;
  portfolioId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<'buy' | 'sell'>(tx.type);
  const [price, setPrice] = useState(String(tx.price));
  const [amount, setAmount] = useState(String(tx.amount));
  const [fee, setFee] = useState(String(tx.fee ?? 0));
  const [note, setNote] = useState(tx.note ?? '');
  const [date, setDate] = useState(toDateInputValue(tx.transactedAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLDivElement>(null);

  async function handleSave() {
    setError(null);
    const p = Number(price);
    const a = Number(amount);
    if (!p || !a || p <= 0 || a <= 0) {
      setError('Price and amount must be positive numbers.');
      return;
    }
    setSaving(true);
    try {
      await createApiClient().updateTransaction(portfolioId, tx.id, {
        type,
        price: p,
        amount: a,
        fee: Number(fee) || 0,
        note: note.trim() || null,
        transactedAt: new Date(date).toISOString(),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update transaction.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} ref={firstRef}>
        <div className="dialog-header">
          <span className="dialog-title">Edit Transaction — {tx.coinId}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="dialog-body">
          {/* Type tabs */}
          <div className="tx-type-tabs" style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              className={`tx-type-tab${type === 'buy' ? ' tx-type-tab--buy' : ''}`}
              onClick={() => setType('buy')}
            >Buy</button>
            <button
              type="button"
              className={`tx-type-tab${type === 'sell' ? ' tx-type-tab--sell' : ''}`}
              onClick={() => setType('sell')}
            >Sell</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <label className="trade-field">
              <span>Amount</span>
              <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="trade-field">
              <span>Price (USD)</span>
              <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="trade-field">
              <span>Fee</span>
              <input type="number" min="0" step="any" value={fee} onChange={(e) => setFee(e.target.value)} />
            </label>
            <label className="trade-field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          <label className="trade-field" style={{ marginTop: '0.75rem' }}>
            <span>Note</span>
            <input type="text" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {/* Total preview */}
          {Number(price) > 0 && Number(amount) > 0 && (
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
              Total: {formatUsd(Number(price) * Number(amount))}
            </p>
          )}

          {error && <p className="trade-form-error" style={{ marginTop: '0.5rem' }}>{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button className="btn btn--secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PortfolioTransactions({ portfolioId, transactions }: PortfolioTransactionsProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTx, setEditTx] = useState<CoinTransaction | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleConfirmDelete() {
    if (!deleteId) return;
    try {
      await createApiClient().deleteTransaction(portfolioId, deleteId);
      setDeleteId(null);
      startTransition(() => { window.location.reload(); });
    } catch {
      // ignore — user can retry
    }
  }

  return (
    <article className="panel">
      <div className="table-header">
        <div>
          <h2>Transactions</h2>
          <p>{transactions.length === 0 ? 'No transactions yet.' : `${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`}</p>
        </div>
      </div>

      {transactions.length > 0 && (
        <div className="tt-wrap">
          <table className="tt">
            <thead>
              <tr>
                <th>Date</th>
                <th>Coin</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Price</th>
                <th>Total Value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="tt-muted">{formatDate(tx.transactedAt)}</td>
                  <td><strong>{tx.coinId}</strong></td>
                  <td>
                    <span className={`tt-side tt-side--${tx.type === 'buy' ? 'long' : 'short'}`}>
                      {tx.type.toUpperCase()}
                    </span>
                  </td>
                  <td>{formatNumber(tx.amount)}</td>
                  <td>{formatExactPrice(tx.price)}</td>
                  <td>
                    {formatUsd(tx.totalValue)}
                    {tx.note && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 2, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.note}>
                        {tx.note}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="tt-actions">
                      <button
                        className="tt-btn"
                        aria-label="Edit transaction"
                        onClick={() => setEditTx(tx)}
                      >
                        Edit
                      </button>
                      <button
                        className="tt-btn tt-btn--danger"
                        aria-label="Delete transaction"
                        onClick={() => setDeleteId(tx.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit dialog */}
      {editTx && (
        <EditTransactionModal
          tx={editTx}
          portfolioId={portfolioId}
          onClose={() => setEditTx(null)}
          onSaved={() => startTransition(() => { window.location.reload(); })}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteId && (
        <div className="dialog-backdrop" onClick={() => setDeleteId(null)}>
          <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Delete Transaction</span>
              <button className="dialog-close" onClick={() => setDeleteId(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-confirm-text">Delete this transaction? Holdings will be recalculated automatically.</p>
              <div className="dialog-confirm-actions">
                <button className="btn btn--secondary" onClick={() => setDeleteId(null)}>Cancel</button>
                <button className="btn btn--danger" onClick={handleConfirmDelete} disabled={isPending}>
                  {isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
