'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { BackTestResult, BackTestResultRecord, BackTestStrategy } from '@web/shared/api/types';

const apiClient = createApiClient();

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

type BackTestFeedProps = Readonly<{
  strategies: BackTestStrategy[];
  initialResults: BackTestResultRecord[];
}>;

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function BackTestFeed({ strategies, initialResults }: BackTestFeedProps) {
  const [strategy, setStrategy] = useState(strategies[0]?.name ?? '');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [from, setFrom] = useState('2024-01-01');
  const [to, setTo] = useState('2024-12-31');
  const [timeframe, setTimeframe] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BackTestResult | null>(null);
  const [results, setResults] = useState<BackTestResultRecord[]>(initialResults);

  async function handleRun() {
    setStatus('running');
    setError(null);
    setResult(null);

    try {
      const res = await apiClient.runBackTest({
        strategy,
        symbol,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        timeframe: timeframe || undefined
      });
      setResult(res);

      const updated = await apiClient.fetchBackTestResults();
      setResults(updated);
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run back-test');
      setStatus('error');
    }
  }

  const selectedStrategy = strategies.find((s) => s.name === strategy);

  return (
    <main className="dashboard-shell back-test-shell">
      <section className="hero-card back-test-hero">
        <div className="hero-copy">
          <p className="eyebrow">Strategy Lab</p>
          <h1>Back-Test</h1>
          <p className="lead">Run historical simulations against available strategies and review results.</p>
        </div>
      </section>

      {/* Run form */}
      <section className="settings-card">
        <p className="settings-card-title">Run a Back-Test</p>

        <div className="settings-fields">
          <div className="back-test-form-grid">
            <div className="settings-field">
              <label className="settings-label">Strategy</label>
              <select className="settings-input" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                {strategies.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
              {selectedStrategy && (
                <p className="back-test-field-hint">{selectedStrategy.description}</p>
              )}
            </div>

            <div className="settings-field">
              <label className="settings-label">Symbol</label>
              <select className="settings-input" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {SYMBOLS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label className="settings-label">Timeframe</label>
              <select className="settings-input" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                <option value="">Default ({selectedStrategy?.defaultTimeframe ?? '4h'})</option>
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label className="settings-label">From</label>
              <input
                className="settings-input"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">To</label>
              <input
                className="settings-input"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <div className="settings-actions">
            <button
              className="btn btn--primary"
              onClick={() => { void handleRun(); }}
              disabled={status === 'running' || strategies.length === 0}
            >
              {status === 'running' ? 'Running…' : 'Run Back-Test'}
            </button>
            {status === 'error' && error && (
              <span className="settings-status settings-status--error">{error}</span>
            )}
          </div>
        </div>
      </section>

      {/* Result */}
      {result && (
        <section className="settings-card">
          <p className="settings-card-title">
            Result — {result.strategy} / {result.symbol} / {result.timeframe}
          </p>
          <div className="back-test-metrics">
            <div className="back-test-metric">
              <span className="back-test-metric-label">Total Trades</span>
              <span className="back-test-metric-value">{result.totalTrades}</span>
            </div>
            <div className="back-test-metric">
              <span className="back-test-metric-label">Win Rate</span>
              <span className="back-test-metric-value">{pct(result.winRate)}</span>
            </div>
            <div className="back-test-metric">
              <span className="back-test-metric-label">Wins / Losses</span>
              <span className="back-test-metric-value">{result.wins} / {result.losses}</span>
            </div>
            <div className="back-test-metric">
              <span className="back-test-metric-label">Total PnL</span>
              <span className={`back-test-metric-value ${result.totalPnl >= 0 ? 'back-test-metric--positive' : 'back-test-metric--negative'}`}>
                {result.totalPnl >= 0 ? '+' : ''}{fmt(result.totalPnl)}
              </span>
            </div>
            <div className="back-test-metric">
              <span className="back-test-metric-label">Max Drawdown</span>
              <span className="back-test-metric-value back-test-metric--negative">{pct(result.maxDrawdown)}</span>
            </div>
            <div className="back-test-metric">
              <span className="back-test-metric-label">Sharpe Ratio</span>
              <span className="back-test-metric-value">{result.sharpeRatio != null ? fmt(result.sharpeRatio) : '—'}</span>
            </div>
          </div>

          {result.trades.length > 0 && (
            <div className="back-test-trades">
              <p className="back-test-trades-title">Trades ({result.trades.length})</p>
              <div className="back-test-trades-table-wrap">
                <table className="back-test-trades-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Dir</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>PnL</th>
                      <th>PnL %</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((trade, i) => (
                      <tr key={i} className={`back-test-trade-row back-test-trade-row--${trade.outcome}`}>
                        <td>{i + 1}</td>
                        <td className={`back-test-direction back-test-direction--${trade.direction}`}>{trade.direction}</td>
                        <td>{fmt(trade.entryPrice)}</td>
                        <td>{fmt(trade.exitPrice)}</td>
                        <td className={trade.pnl >= 0 ? 'back-test-metric--positive' : 'back-test-metric--negative'}>
                          {trade.pnl >= 0 ? '+' : ''}{fmt(trade.pnl)}
                        </td>
                        <td className={trade.pnlPercent >= 0 ? 'back-test-metric--positive' : 'back-test-metric--negative'}>
                          {trade.pnlPercent >= 0 ? '+' : ''}{pct(trade.pnlPercent)}
                        </td>
                        <td><span className={`back-test-outcome back-test-outcome--${trade.outcome}`}>{trade.outcome}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* History */}
      <section className="settings-card">
        <p className="settings-card-title">History</p>
        {results.length === 0 ? (
          <p className="back-test-empty">No back-tests run yet.</p>
        ) : (
          <div className="back-test-trades-table-wrap">
            <table className="back-test-trades-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Symbol</th>
                  <th>TF</th>
                  <th>Trades</th>
                  <th>Win Rate</th>
                  <th>PnL</th>
                  <th>Drawdown</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>{r.strategy}</td>
                    <td>{r.symbol}</td>
                    <td>{r.timeframe}</td>
                    <td>{r.totalTrades}</td>
                    <td>{pct(r.winRate)}</td>
                    <td className={r.totalPnl >= 0 ? 'back-test-metric--positive' : 'back-test-metric--negative'}>
                      {r.totalPnl >= 0 ? '+' : ''}{fmt(r.totalPnl)}
                    </td>
                    <td>{pct(r.maxDrawdown)}</td>
                    <td><span className={`back-test-outcome back-test-outcome--${r.status}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
