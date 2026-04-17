'use client';

import type { PnlSnapshot } from '@web/shared/api/types';

type PortfolioPnlProps = Readonly<{
  snapshots: PnlSnapshot[];
}>;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

export function PortfolioPnl({ snapshots }: PortfolioPnlProps) {
  // Show aggregate (coinId = null) snapshots first; fall back to all if none
  const aggregate = snapshots.filter((s) => s.coinId === null);
  const rows = aggregate.length > 0 ? aggregate : snapshots;

  return (
    <article className="panel">
      <div className="table-header">
        <div>
          <h2>PnL History</h2>
          <p>Daily unrealized PnL snapshots</p>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="tt-wrap">
          <table className="tt">
            <thead>
              <tr>
                <th>Date</th>
                {aggregate.length === 0 && <th>Coin</th>}
                <th>Unrealized PnL</th>
                <th>Total Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="tt-muted">{formatDate(s.date)}</td>
                  {aggregate.length === 0 && <td><strong>{s.coinId ?? '—'}</strong></td>}
                  <td><PnlCell value={s.unrealizedPnl} /></td>
                  <td>{formatUsd(s.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="tt-muted" style={{ padding: '1rem' }}>No PnL snapshots yet. Snapshots are generated daily at 23:00.</p>
      )}
    </article>
  );
}
