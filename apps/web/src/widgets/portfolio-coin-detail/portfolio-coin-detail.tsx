'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import { CreateTransactionForm } from '@web/features/create-transaction/create-transaction-form';
import { createApiClient } from '@web/shared/api/client';
import { formatCryptoPrice } from '@web/shared/lib/format';
import type { CoinTransaction, Holding, Portfolio } from '@web/shared/api/types';
import { CoinChatDrawer } from '@web/widgets/coin-chat-drawer/coin-chat-drawer';

type PortfolioCoinDetailProps = Readonly<{
  portfolioId: string;
  coinId: string;
  holding: Holding | null;
  transactions: CoinTransaction[];
}>;

const TX_PAGE_SIZE = 10;

/** Compact page list with ellipsis, e.g. [1, '...', 4, 5, 6, '...', 12]. */
function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 1) return [1];
  const pages: (number | '...')[] = [1];
  if (current > 3) pages.push('...');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatPrice(value: number): string {
  const maxDecimals = value >= 1 ? 3 : 10;
  const minDecimals = value >= 1 ? 3 : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: minDecimals, maximumFractionDigits: maxDecimals }).format(value);
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

function toDateTimeInputValue(dateStr: string): string {
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [date, setDate] = useState(toDateTimeInputValue(tx.transactedAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        type, price: p, amount: a,
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

  const total = Number(price) * Number(amount);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Edit Transaction — {tx.coinId}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="dialog-body">
          <div className="tx-type-tabs" style={{ marginBottom: '1rem' }}>
            <button type="button" className={`tx-type-tab${type === 'buy' ? ' tx-type-tab--buy' : ''}`} onClick={() => setType('buy')}>Buy</button>
            <button type="button" className={`tx-type-tab${type === 'sell' ? ' tx-type-tab--sell' : ''}`} onClick={() => setType('sell')}>Sell</button>
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
              <span>Date &amp; Time</span>
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="trade-field" style={{ marginTop: '0.75rem' }}>
            <span>Note</span>
            <input type="text" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {total > 0 && (
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
              Total: {formatUsd(total)}
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

function TransferCoinModal({
  portfolioId,
  coinId,
  onClose
}: {
  portfolioId: string;
  coinId: string;
  onClose: () => void;
}) {
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createApiClient()
      .fetchPortfolios()
      .then((list) => setPortfolios(list.filter((p) => p.id !== portfolioId)))
      .catch(() => setError('Failed to load portfolios'));
  }, [portfolioId]);

  async function handleTransfer() {
    if (!targetId) return;
    setSaving(true);
    setError(null);
    try {
      await createApiClient().transferHolding(portfolioId, coinId, targetId);
      // The coin now lives in the target portfolio — navigate there.
      window.location.href = `/portfolio/${targetId}/${coinId}`;
    } catch {
      setError('Transfer failed. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Transfer {coinId}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="dialog-body">
          <p className="tt-muted" style={{ marginTop: 0 }}>
            Move the entire {coinId} position — all of its transactions and cost basis — into another
            portfolio. If the destination already holds {coinId}, the positions are merged.
          </p>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.4rem' }}>
            Destination portfolio
          </label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={!portfolios || saving}
            style={{ width: '100%', padding: '0.6rem', borderRadius: 8, background: 'var(--panel-bg, rgba(255,255,255,0.04))', color: 'inherit', border: '1px solid var(--border)' }}
          >
            <option value="">{portfolios ? 'Select a portfolio…' : 'Loading…'}</option>
            {portfolios?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {portfolios && portfolios.length === 0 && (
            <p className="tt-muted" style={{ fontSize: '0.85rem' }}>You have no other portfolio to transfer into.</p>
          )}
          {error && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>}
          <div className="dialog-confirm-actions" style={{ marginTop: '1rem' }}>
            <button className="btn btn--secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn--primary" onClick={handleTransfer} disabled={!targetId || saving}>
              {saving ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PortfolioCoinDetail({ portfolioId, coinId, holding, transactions }: PortfolioCoinDetailProps) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTx, setEditTx] = useState<CoinTransaction | null>(null);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [isPending, startTransition] = useTransition();

  // Toggle a type chip: clicking the active one clears the filter (back to all).
  function toggleTypeFilter(type: 'buy' | 'sell') {
    setTypeFilter((prev) => (prev === type ? 'all' : type));
    setPage(1);
  }

  const filteredTransactions = typeFilter === 'all'
    ? transactions
    : transactions.filter((tx) => tx.type === typeFilter);
  const totalTx = filteredTransactions.length;
  const totalPages = Math.max(1, Math.ceil(totalTx / TX_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageTransactions = filteredTransactions.slice((safePage - 1) * TX_PAGE_SIZE, safePage * TX_PAGE_SIZE);

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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn--secondary" onClick={() => setAskOpen(true)}>Ask AI</button>
          {transactions.length > 0 && (
            <button className="btn btn--secondary" onClick={() => setTransferOpen(true)}>Transfer</button>
          )}
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>+ Add Transaction</button>
        </div>
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
          <h2 style={{ margin: 0 }}>
            Transactions
            <span style={{ marginLeft: '0.5rem', color: 'var(--muted)', fontWeight: 500, fontSize: '0.9rem' }}>
              ({totalTx})
            </span>
          </h2>
          <div className="tx-filter-chips">
            <button
              type="button"
              className={`tx-filter-chip tx-filter-chip--buy${typeFilter === 'buy' ? '' : ' tx-filter-chip--off'}`}
              aria-pressed={typeFilter === 'buy'}
              onClick={() => toggleTypeFilter('buy')}
            >
              Buy
            </button>
            <button
              type="button"
              className={`tx-filter-chip tx-filter-chip--sell${typeFilter === 'sell' ? '' : ' tx-filter-chip--off'}`}
              aria-pressed={typeFilter === 'sell'}
              onClick={() => toggleTypeFilter('sell')}
            >
              Sell
            </button>
          </div>
        </div>

        {pageTransactions.length > 0 ? (
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
                {pageTransactions.map((tx) => {
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
                            className="tt-btn"
                            aria-label="Edit transaction"
                            onClick={() => setEditTx(tx)}
                          >
                            Edit
                          </button>
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
          <p className="tt-muted" style={{ padding: '1rem' }}>
            {typeFilter === 'all' ? 'No transactions yet.' : `No ${typeFilter} transactions.`}
          </p>
        )}

        {totalPages > 1 && (
          <div className="tt-pagination">
            <button
              className="tt-pagination__btn"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage <= 1}
              aria-label="Previous page"
            >
              ← Prev
            </button>
            {getPageNumbers(safePage, totalPages).map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="tt-pagination__ellipsis">…</span>
              ) : (
                <button
                  key={p}
                  className={`tt-pagination__btn${p === safePage ? ' tt-pagination__btn--active' : ''}`}
                  onClick={() => setPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === safePage ? 'page' : undefined}
                >
                  {p}
                </button>
              )
            )}
            <button
              className="tt-pagination__btn"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= totalPages}
              aria-label="Next page"
            >
              Next →
            </button>
          </div>
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
              <CreateTransactionForm
                portfolioId={portfolioId}
                defaultCoinId={coinId}
                defaultPrice={currentPrice ?? undefined}
                holdingsBySymbol={totalAmount > 0 ? { [coinId]: totalAmount } : undefined}
                onSubmitted={() => setAddOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit transaction dialog */}
      {editTx && (
        <EditTransactionModal
          tx={editTx}
          portfolioId={portfolioId}
          onClose={() => setEditTx(null)}
          onSaved={() => startTransition(() => { window.location.reload(); })}
        />
      )}

      {/* Transfer coin dialog */}
      {transferOpen && (
        <TransferCoinModal portfolioId={portfolioId} coinId={coinId} onClose={() => setTransferOpen(false)} />
      )}

      {/* AI Chat Drawer */}
      {askOpen && (
        <CoinChatDrawer
          coinId={coinId}
          portfolioId={portfolioId}
          holding={holding}
          currentPrice={currentPrice}
          onClose={() => setAskOpen(false)}
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
    </main>
  );
}
