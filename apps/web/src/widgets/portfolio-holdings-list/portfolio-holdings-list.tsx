'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { CreateTransactionForm } from '@web/features/create-transaction/create-transaction-form';
import type { Holding } from '@web/shared/api/types';

type PortfolioHoldingsListProps = Readonly<{
  portfolioId: string;
  holdings: Holding[];
}>;

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatCrypto(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value);
}

function PnlCell({ value, invested }: { value: number; invested: number }) {
  const isPositive = value >= 0;
  const pct = invested > 0 ? (value / invested) * 100 : 0;
  return (
    <div>
      <div className={isPositive ? 'tt-pnl-positive' : 'tt-pnl-negative'}>
        {isPositive ? '+' : ''}{formatUsd(value)}
      </div>
      <div style={{ fontSize: '0.75rem', color: isPositive ? '#22c55e' : '#ef4444' }}>
        {isPositive ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
      </div>
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
              {holdings.map((h) => {
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
                          ? formatUsd(currentPrice)
                          : <span className="tt-muted">—</span>
                      }
                    </td>
                    <td data-label="Avg. Buy">{formatUsd(h.avgCost)}</td>
                    <td data-label="Holdings">
                      <div>{formatCrypto(h.totalAmount)} {h.coinId}</div>
                      {currentValue != null && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{formatUsd(currentValue)}</div>
                      )}
                    </td>
                    <td data-label="P/L">
                      {pricesLoaded
                        ? <PnlCell value={totalPnl} invested={h.totalInvested} />
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
  );
}
