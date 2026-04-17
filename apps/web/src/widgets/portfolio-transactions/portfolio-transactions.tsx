'use client';

import { useState, useTransition } from 'react';

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

export function PortfolioTransactions({ portfolioId, transactions }: PortfolioTransactionsProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
                  <td className="tt-muted">{formatDate(tx.date)}</td>
                  <td><strong>{tx.coinId}</strong></td>
                  <td>
                    <span className={`tt-side tt-side--${tx.type === 'BUY' ? 'long' : 'short'}`}>
                      {tx.type}
                    </span>
                  </td>
                  <td>{formatNumber(tx.amount)}</td>
                  <td>{formatUsd(tx.price)}</td>
                  <td>{formatUsd(tx.totalValue)}</td>
                  <td>
                    <div className="tt-actions">
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
