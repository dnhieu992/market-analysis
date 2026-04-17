'use client';

import { useState, useTransition } from 'react';

import { CreateTransactionForm } from '@web/features/create-transaction/create-transaction-form';
import { createApiClient } from '@web/shared/api/client';
import type { Holding } from '@web/shared/api/types';

type PortfolioHoldingsProps = Readonly<{
  portfolioId: string;
  holdings: Holding[];
}>;

function formatNumber(value: number, decimals = 4): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals }).format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function PnlCell({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <span className={isPositive ? 'tt-pnl-positive' : 'tt-pnl-negative'}>
      {isPositive ? '+' : ''}{formatUsd(value)}
    </span>
  );
}

export function PortfolioHoldings({ portfolioId, holdings }: PortfolioHoldingsProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [isRecalculating, startRecalculate] = useTransition();

  async function handleRecalculate() {
    try {
      await createApiClient().recalculateHoldings(portfolioId);
      startRecalculate(() => { window.location.reload(); });
    } catch {
      // ignore
    }
  }

  const totalInvested = holdings.reduce((s, h) => s + h.totalInvested, 0);
  const totalRealizedPnl = holdings.reduce((s, h) => s + h.realizedPnl, 0);

  return (
    <article className="panel">
      <div className="table-header">
        <div>
          <h2>Holdings</h2>
          <p>
            Total invested: <strong>{formatUsd(totalInvested)}</strong>
            {' · '}
            Realized PnL: <strong><PnlCell value={totalRealizedPnl} /></strong>
          </p>
        </div>
        <div className="table-actions">
          <button className="btn btn--secondary" onClick={handleRecalculate} disabled={isRecalculating}>
            {isRecalculating ? 'Recalculating...' : 'Recalculate'}
          </button>
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>+ Add Transaction</button>
        </div>
      </div>

      {holdings.length > 0 ? (
        <div className="tt-wrap">
          <table className="tt">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Amount</th>
                <th>Avg Cost</th>
                <th>Total Invested</th>
                <th>Realized PnL</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.coinId}>
                  <td><strong>{h.coinId}</strong></td>
                  <td>{formatNumber(h.totalAmount)}</td>
                  <td>{formatUsd(h.avgCost)}</td>
                  <td>{formatUsd(h.totalInvested)}</td>
                  <td><PnlCell value={h.realizedPnl} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="tt-muted" style={{ padding: '1rem' }}>No holdings yet. Add a BUY transaction to get started.</p>
      )}

      {/* Add transaction dialog */}
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
