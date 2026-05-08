'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { CreateTransactionForm } from '@web/features/create-transaction/create-transaction-form';
import type { Holding } from '@web/shared/api/types';

type PortfolioHoldingsListProps = Readonly<{
  portfolioId: string;
  holdings: Holding[];
}>;

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}


function formatExactPrice(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(value);
}

function formatCrypto(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value);
}

function PnlCell({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <div className={isPositive ? 'tt-pnl-positive' : 'tt-pnl-negative'}>
      {isPositive ? '+' : ''}{formatUsd(value)}
    </div>
  );
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

function CoinAvatar({ coinId }: { coinId: string }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      background: 'rgba(247,147,26,0.2)', color: '#f7931a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.65rem', fontWeight: 700, flexShrink: 0,
    }}>
      {coinId.slice(0, 1)}
    </div>
  );
}

function PortfolioStatsPanel({ holdings, prices, pricesLoaded }: {
  holdings: Holding[];
  prices: Record<string, number>;
  pricesLoaded: boolean;
}) {
  if (holdings.length === 0) return null;

  const stats = holdings.map((h) => {
    const currentPrice = prices[h.coinId];
    const unrealizedPnl = currentPrice != null ? (currentPrice - h.avgCost) * h.totalAmount : 0;
    const totalPnl = unrealizedPnl + h.realizedPnl;
    const pnlPct = h.totalInvested > 0 ? (totalPnl / h.totalInvested) * 100 : 0;
    return { coinId: h.coinId, totalPnl, pnlPct, totalInvested: h.totalInvested };
  });

  const allTimeProfit = stats.reduce((sum, s) => sum + s.totalPnl, 0);
  const totalCostBasis = stats.reduce((sum, s) => sum + s.totalInvested, 0);
  const isProfitPositive = allTimeProfit >= 0;

  const best = [...stats].sort((a, b) => b.pnlPct - a.pnlPct)[0];
  const worst = [...stats].sort((a, b) => a.pnlPct - b.pnlPct)[0];

  const cardStyle: React.CSSProperties = {
    background: 'var(--panel-bg, rgba(255,255,255,0.04))',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '1.25rem 1.5rem',
    minWidth: 0,
  };
  const labelStyle: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.5rem' };
  const loading = !pricesLoaded;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
      {/* All-time profit */}
      <div style={cardStyle}>
        <div style={labelStyle}>All-time profit</div>
        {loading ? (
          <span className="tt-muted">loading…</span>
        ) : (
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: isProfitPositive ? '#22c55e' : '#ef4444' }}>
            {isProfitPositive ? '+' : ''}{formatUsd(allTimeProfit)}
          </div>
        )}
      </div>

      {/* Cost basis */}
      <div style={cardStyle}>
        <div style={labelStyle}>Cost Basis</div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatUsd(totalCostBasis)}</div>
      </div>

      {/* Best performer */}
      <div style={cardStyle}>
        <div style={labelStyle}>Best Performer</div>
        {loading ? <span className="tt-muted">loading…</span> : best ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
              <CoinAvatar coinId={best.coinId} />
              <span style={{ fontWeight: 700 }}>{best.coinId}</span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: best.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
              {best.totalPnl >= 0 ? '+' : ''}{formatUsd(best.totalPnl)}
            </div>
          </>
        ) : null}
      </div>

      {/* Worst performer */}
      <div style={cardStyle}>
        <div style={labelStyle}>Worst Performer</div>
        {loading ? <span className="tt-muted">loading…</span> : worst ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
              <CoinAvatar coinId={worst.coinId} />
              <span style={{ fontWeight: 700 }}>{worst.coinId}</span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: worst.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
              {worst.totalPnl >= 0 ? '+' : ''}{formatUsd(worst.totalPnl)}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function PortfolioHoldingsList({ portfolioId, holdings }: PortfolioHoldingsListProps) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesLoaded, setPricesLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (holdings.length === 0) { setPricesLoaded(true); return; }
    fetchPrices(holdings.map((h) => h.coinId))
      .then((p) => { setPrices(p); setPricesLoaded(true); });
  }, [holdings]);

  return (
    <>
      <PortfolioStatsPanel holdings={holdings} prices={prices} pricesLoaded={pricesLoaded} />
    <article className="panel">
      <div className="table-header">
        <div>
          <h2>Holdings</h2>
          <p>{holdings.length === 0 ? 'No holdings yet.' : `${holdings.length} coin${holdings.length === 1 ? '' : 's'}`}</p>
        </div>
        <div className="table-actions">
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>+ Add Transaction</button>
        </div>
      </div>

      {holdings.length > 0 && (
        <div className="tt-wrap tt-card-wrap">
          <table className="tt tt-card">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Current Price</th>
                <th>Avg. Buy Price</th>
                <th>Holdings</th>
                <th>Profit / Loss</th>
              </tr>
            </thead>
            <tbody>
              {[...holdings].sort((a, b) => {
                const priceA = prices[a.coinId] ?? 0;
                const priceB = prices[b.coinId] ?? 0;
                const pnlA = (priceA - a.avgCost) * a.totalAmount + a.realizedPnl;
                const pnlB = (priceB - b.avgCost) * b.totalAmount + b.realizedPnl;
                return pnlB - pnlA;
              }).map((h) => {
                const currentPrice = prices[h.coinId];
                const currentValue = currentPrice != null ? currentPrice * h.totalAmount : null;
                const unrealizedPnl = currentPrice != null ? (currentPrice - h.avgCost) * h.totalAmount : 0;
                const totalPnl = unrealizedPnl + h.realizedPnl;

                return (
                  <tr key={h.coinId}>
                    <td data-label="Coin" data-full="">
                      <Link href={`/portfolio/${portfolioId}/${h.coinId}`} className="tt-symbol-btn">
                        <strong>{h.coinId}</strong>
                      </Link>
                    </td>
                    <td data-label="Current Price">
                      {!pricesLoaded
                        ? <span className="tt-muted">loading…</span>
                        : currentPrice != null
                          ? formatExactPrice(currentPrice)
                          : <span className="tt-muted">—</span>
                      }
                    </td>
                    <td data-label="Avg. Buy">{formatExactPrice(h.avgCost)}</td>
                    <td data-label="Holdings">
                      <div>{formatCrypto(h.totalAmount)} {h.coinId}</div>
                      {currentValue != null && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{formatUsd(currentValue)}</div>
                      )}
                    </td>
                    <td data-label="P/L">
                      {pricesLoaded
                        ? <PnlCell value={totalPnl} />
                        : <span className="tt-muted">loading…</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <div className="dialog-backdrop" onClick={() => setAddOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Add Transaction</span>
              <button className="dialog-close" onClick={() => setAddOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CreateTransactionForm portfolioId={portfolioId} onSubmitted={() => setAddOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </article>
    </>
  );
}
