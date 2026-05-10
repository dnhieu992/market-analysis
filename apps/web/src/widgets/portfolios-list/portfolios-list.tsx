'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import { CreatePortfolioForm } from '@web/features/create-portfolio/create-portfolio-form';
import { EditPortfolioForm } from '@web/features/edit-portfolio/edit-portfolio-form';
import { createApiClient } from '@web/shared/api/client';
import type { Holding, Portfolio } from '@web/shared/api/types';

type PortfoliosListProps = Readonly<{
  portfolios: Portfolio[];
  holdingsMap: Record<string, Holding[]>;
}>;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

async function fetchPrices(coinIds: string[]): Promise<Record<string, number>> {
  if (coinIds.length === 0) return {};
  try {
    const symbols = JSON.stringify(coinIds.map((c) => `${c}USDT`));
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(symbols)}`);
    const data = await res.json() as { symbol: string; price: string }[];
    const map: Record<string, number> = {};
    for (const item of data) {
      const coin = item.symbol.replace('USDT', '');
      map[coin] = Number(item.price);
    }
    return map;
  } catch {
    return {};
  }
}

function computeAllTimeProfit(holdings: Holding[], prices: Record<string, number>): number {
  return holdings.reduce((sum, h) => {
    const currentPrice = prices[h.coinId] ?? 0;
    const unrealizedPnl = (currentPrice - h.avgCost) * h.totalAmount;
    return sum + unrealizedPnl + h.realizedPnl;
  }, 0);
}

function computeCurrentUse(holdings: Holding[]): number {
  return holdings.reduce((sum, h) => sum + h.totalInvested, 0);
}

function ProfitCell({ profit, loaded }: { profit: number; loaded: boolean }) {
  if (!loaded) return <span className="tt-muted" style={{ fontSize: '0.8rem' }}>loading…</span>;
  const isPositive = profit >= 0;
  return (
    <span style={{ fontWeight: 600, color: isPositive ? '#22c55e' : '#ef4444' }}>
      {isPositive ? '+' : ''}{formatUsd(profit)}
    </span>
  );
}

function IconEdit() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

export function PortfoliosList({ portfolios, holdingsMap }: PortfoliosListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPortfolio, setEditPortfolio] = useState<Portfolio | null>(null);
  const [deletePortfolioId, setDeletePortfolioId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesLoaded, setPricesLoaded] = useState(false);

  useEffect(() => {
    const allCoinIds = [...new Set(Object.values(holdingsMap).flat().map((h) => h.coinId))];
    if (allCoinIds.length === 0) { setPricesLoaded(true); return; }
    fetchPrices(allCoinIds).then((p) => { setPrices(p); setPricesLoaded(true); });
  }, [holdingsMap]);

  async function handleConfirmDelete() {
    if (!deletePortfolioId) return;
    try {
      await createApiClient().deletePortfolio(deletePortfolioId);
      setDeletePortfolioId(null);
      startTransition(() => { window.location.reload(); });
    } catch {
      // ignore — user can retry
    }
  }

  return (
    <main className="dashboard-shell trades-shell">
      <article className="panel">
        <div className="table-header">
          <div>
            <h2>My Portfolios</h2>
            <p>{portfolios.length === 0 ? 'No portfolios yet.' : `${portfolios.length} portfolio${portfolios.length === 1 ? '' : 's'}`}</p>
          </div>
          <div className="table-actions">
            <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>+ New Portfolio</button>
          </div>
        </div>

        {portfolios.length > 0 && (
          <div className="tt-wrap tt-card-wrap">
            <table className="tt tt-card">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>All-time Profit</th>
                  <th>Total Capital</th>
                  <th>Current Use</th>
                  <th>Coins Holding</th>
                  <th>Description</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {portfolios.map((portfolio) => {
                  const holdings = holdingsMap[portfolio.id] ?? [];
                  const activeHoldings = holdings.filter((h) => h.totalAmount > 0);
                  const profit = computeAllTimeProfit(holdings, prices);
                  const currentUse = computeCurrentUse(activeHoldings);
                  const capitalPct = portfolio.totalCapital && portfolio.totalCapital > 0
                    ? (currentUse / portfolio.totalCapital) * 100
                    : null;
                  return (
                  <tr key={portfolio.id}>
                    {/* Full-width: portfolio name */}
                    <td data-label="Portfolio" data-full="">
                      <Link href={`/portfolio/${portfolio.id}`} className="tt-symbol-btn">
                        {portfolio.name}
                      </Link>
                    </td>
                    <td data-label="All-time Profit">
                      {holdings.length === 0
                        ? <span className="tt-muted">—</span>
                        : <ProfitCell profit={profit} loaded={pricesLoaded} />
                      }
                    </td>
                    <td data-label="Total Capital">
                      {portfolio.totalCapital != null
                        ? <span style={{ fontWeight: 600 }}>{formatUsd(portfolio.totalCapital)}</span>
                        : <span className="tt-muted">—</span>
                      }
                    </td>
                    <td data-label="Current Use">
                      {activeHoldings.length === 0
                        ? <span className="tt-muted">—</span>
                        : (
                          <div>
                            <span style={{ fontWeight: 600 }}>{formatUsd(currentUse)}</span>
                            {capitalPct != null && (
                              <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                {capitalPct.toFixed(1)}% of capital
                              </div>
                            )}
                          </div>
                        )
                      }
                    </td>
                    <td data-label="Coins Holding">
                      {activeHoldings.length > 0
                        ? <span style={{ fontWeight: 600 }}>{activeHoldings.length} coin{activeHoldings.length === 1 ? '' : 's'}</span>
                        : <span className="tt-muted">—</span>
                      }
                    </td>
                    <td data-label="Description" className="tt-muted">{portfolio.description ?? '—'}</td>
                    <td data-label="Created" className="tt-muted">{formatDate(portfolio.createdAt)}</td>
                    {/* Full-width: actions */}
                    <td data-label="" data-full="">
                      <div className="tt-actions">
                        <button
                          className="tt-btn"
                          onClick={() => setEditPortfolio(portfolio)}
                          aria-label="Edit portfolio"
                          data-tooltip="Edit"
                        >
                          <IconEdit />
                        </button>
                        <button
                          className="tt-btn tt-btn--danger"
                          onClick={() => setDeletePortfolioId(portfolio.id)}
                          aria-label="Delete portfolio"
                          data-tooltip="Delete"
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
        )}
      </article>

      {/* Create portfolio dialog */}
      {createOpen && (
        <div className="dialog-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">New Portfolio</span>
              <button className="dialog-close" onClick={() => setCreateOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CreatePortfolioForm onSubmitted={() => setCreateOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Edit portfolio dialog */}
      {editPortfolio && (
        <div className="dialog-backdrop" onClick={() => setEditPortfolio(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Edit Portfolio</span>
              <button className="dialog-close" onClick={() => setEditPortfolio(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <EditPortfolioForm portfolio={editPortfolio} onSubmitted={() => setEditPortfolio(null)} />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deletePortfolioId && (
        <div className="dialog-backdrop" onClick={() => setDeletePortfolioId(null)}>
          <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Delete Portfolio</span>
              <button className="dialog-close" onClick={() => setDeletePortfolioId(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-confirm-text">Are you sure you want to delete this portfolio? All holdings and transactions will be removed.</p>
              <div className="dialog-confirm-actions">
                <button className="btn btn--secondary" onClick={() => setDeletePortfolioId(null)}>Cancel</button>
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
