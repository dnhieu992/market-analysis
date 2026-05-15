'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import { CreateTransactionForm } from '@web/features/create-transaction/create-transaction-form';
import { createApiClient } from '@web/shared/api/client';
import { formatCryptoPrice } from '@web/shared/lib/format';
import type { CoinTransaction, Holding } from '@web/shared/api/types';

type PortfolioCoinDetailProps = Readonly<{
  portfolioId: string;
  coinId: string;
  holding: Holding | null;
  transactions: CoinTransaction[];
}>;

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatPrice(value: number): string {
  const decimals = value >= 1 ? 3 : 5;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

function formatCrypto(value: number, coin: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value)} ${coin}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--panel-bg, rgba(255,255,255,0.04))',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '1.25rem 1.5rem',
      minWidth: 0,
    }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{children}</div>
    </div>
  );
}

function TypeAvatar({ type }: { type: 'buy' | 'sell' }) {
  const letter = type === 'buy' ? 'B' : 'S';
  const bg = type === 'buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
  const color = type === 'buy' ? '#22c55e' : '#ef4444';
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%',
      background: bg, color, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.9rem', flexShrink: 0
    }}>
      {letter}
    </div>
  );
}

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

export function PortfolioCoinDetail({ portfolioId, coinId, holding, transactions }: PortfolioCoinDetailProps) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${coinId}USDT`)
      .then((r) => r.json())
      .then((d: { price?: string }) => { if (d.price) setCurrentPrice(Number(d.price)); })
      .catch(() => {});
  }, [coinId]);

  async function handleConfirmDelete() {
    if (!deleteId) return;
    try {
      await createApiClient().deleteTransaction(portfolioId, deleteId);
      setDeleteId(null);
      startTransition(() => { window.location.reload(); });
    } catch {
      // ignore
    }
  }

  const totalAmount = holding?.totalAmount ?? 0;
  const avgCost = holding?.avgCost ?? 0;
  const totalInvested = holding?.totalInvested ?? 0;
  const realizedPnl = holding?.realizedPnl ?? 0;
  const unrealizedPnl = currentPrice != null ? (currentPrice - avgCost) * totalAmount : 0;
  const totalPnl = unrealizedPnl + realizedPnl;
  const isPnlPositive = totalPnl >= 0;
  const avgPricePct = avgCost > 0 && currentPrice != null ? ((currentPrice - avgCost) / avgCost) * 100 : null;
  const isAvgPricePctPositive = avgPricePct != null && avgPricePct >= 0;

  return (
    <main className="dashboard-shell">
      {/* Back button */}
      <div style={{ padding: '0.75rem 0 0' }}>
        <Link
          href={`/portfolio/${portfolioId}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--muted)', textDecoration: 'none', fontSize: '0.95rem' }}
        >
          ‹ Back
        </Link>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0.75rem 0 0.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', fontWeight: 600, color: 'var(--muted)' }}>{coinId}</h1>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>
            {currentPrice != null ? formatPrice(currentPrice) : <span style={{ color: 'var(--muted)', fontSize: '1.2rem' }}>Fetching price…</span>}
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setAddOpen(true)}>+ Add Transaction</button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', padding: '1rem 0' }}>
        <StatCard label="Quantity">
          {formatCrypto(totalAmount, coinId)}
        </StatCard>
        <StatCard label="Avg. buy price">
          {formatCryptoPrice(avgCost)}
          {avgPricePct != null && (
            <div style={{ fontSize: '0.85rem', fontWeight: 500, color: isAvgPricePctPositive ? '#22c55e' : '#ef4444', marginTop: '0.2rem' }}>
              {isAvgPricePctPositive ? '▲' : '▼'} {Math.abs(avgPricePct).toFixed(2)}%
            </div>
          )}
        </StatCard>
        <StatCard label="Basic Cost">
          {formatUsd(totalInvested)}
        </StatCard>
        <StatCard label="Total profit / loss">
          <span className={isPnlPositive ? 'tt-pnl-positive' : 'tt-pnl-negative'}>
            {isPnlPositive ? '+' : ''}{formatUsd(totalPnl)}
          </span>
        </StatCard>
      </div>

      {/* Transactions */}
      <article className="panel">
        <div className="table-header">
          <h2 style={{ margin: 0 }}>Transactions</h2>
        </div>

        {transactions.length > 0 ? (
          <div className="tt-wrap tt-card-wrap">
            <table className="tt tt-card">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Price</th>
                  <th>Amount</th>
                  <th>Fees</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isBuy = tx.type === 'buy';
                  const amountSign = isBuy ? '+' : '-';
                  const amountColor = isBuy ? '#22c55e' : '#ef4444';
                  return (
                    <tr key={tx.id}>
                      {/* Type + date */}
                      <td data-label="Type" data-full="">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <TypeAvatar type={tx.type} />
                          <div>
                            <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{tx.type}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{formatDateTime(tx.transactedAt)}</div>
                          </div>
                        </div>
                      </td>
                      {/* Price */}
                      <td data-label="Price">{formatCryptoPrice(tx.price)}</td>
                      {/* Amount */}
                      <td data-label="Amount">
                        <div style={{ color: amountColor, fontWeight: 500 }}>
                          {amountSign}{formatUsd(tx.totalValue)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: amountColor }}>
                          {amountSign}{formatCrypto(tx.amount, coinId)}
                        </div>
                      </td>
                      {/* Fees */}
                      <td data-label="Fees" style={{ color: 'var(--muted)' }}>
                        {tx.fee > 0 ? formatUsd(tx.fee) : '--'}
                      </td>
                      {/* Actions */}
                      <td data-label="Actions">
                        <div className="tt-actions">
                          <button
                            className="tt-btn tt-btn--danger"
                            aria-label="Delete transaction"
                            data-tooltip="Delete"
                            onClick={() => setDeleteId(tx.id)}
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="tt-muted" style={{ padding: '1rem' }}>No transactions yet.</p>
        )}
      </article>

      {/* Add transaction dialog */}
      {addOpen && (
        <div className="dialog-backdrop" onClick={() => setAddOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Add {coinId} Transaction</span>
              <button className="dialog-close" onClick={() => setAddOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CreateTransactionForm portfolioId={portfolioId} defaultCoinId={coinId} defaultPrice={currentPrice ?? undefined} onSubmitted={() => setAddOpen(false)} />
            </div>
          </div>
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
    </main>
  );
}
