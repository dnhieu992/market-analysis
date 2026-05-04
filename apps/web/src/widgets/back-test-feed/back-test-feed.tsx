'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { BackTestResult, BackTestResultRecord, BackTestStrategy } from '@web/shared/api/types';

const apiClient = createApiClient();

const TIMEFRAMES = ['5m', '15m', 'M30', '1h', '4h', '1d'];

type BackTestFeedProps = Readonly<{
  strategies: BackTestStrategy[];
  initialResults: BackTestResultRecord[];
}>;

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export function BackTestFeed({ strategies, initialResults }: BackTestFeedProps) {
  const [strategy, setStrategy] = useState(strategies[0]?.name ?? '');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
  });
  const [timeframe, setTimeframe] = useState('');
  // FOMO strategy params
  const [fomoTpSteps, setFomoTpSteps] = useState(1000);
  const [fomoLongTpPct, setFomoLongTpPct] = useState(1); // percentage, e.g. 1 = 1%
  const [fomoEntryHour, setFomoEntryHour] = useState(3);
  const [fomoExitHour, setFomoExitHour] = useState(16);
  // RSI Reversal params
  const [rsiTpPct, setRsiTpPct] = useState(10);
  const [rsiSlPct, setRsiSlPct] = useState(10);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BackTestResult | null>(null);
  const [results, setResults] = useState<BackTestResultRecord[]>(initialResults);
  const [selectedResult, setSelectedResult] = useState<BackTestResult | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleRun() {
    setStatus('running');
    setError(null);
    setResult(null);

    try {
      const params = strategy === 'fomo-long'
        ? { tpPct: fomoLongTpPct / 100, entryHourUtc: fomoEntryHour, exitHourUtc: fomoExitHour }
        : strategy === 'fomo-short'
          ? { tpSteps: fomoTpSteps, entryHourUtc: fomoEntryHour, exitHourUtc: fomoExitHour }
        : strategy === 'rsi-reversal'
          ? { tpPct: rsiTpPct / 100, slPct: rsiSlPct / 100 }
          : undefined;

      const res = await apiClient.runBackTest({
        strategy,
        symbol,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        timeframe: timeframe || undefined,
        params
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

  async function handleSelectResult(id: string) {
    if (selectedResult?.id === id) {
      setSelectedResult(null);
      return;
    }
    setLoadingId(id);
    try {
      const detail = await apiClient.fetchBackTestResult(id);
      setSelectedResult(detail);
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDeleteResult(id: string) {
    setDeletingId(id);
    try {
      await apiClient.deleteBackTestResult(id);
      setResults((prev) => prev.filter((r) => r.id !== id));
      if (selectedResult?.id === id) setSelectedResult(null);
    } finally {
      setDeletingId(null);
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
              <label className="settings-label">
                Strategy
                {selectedStrategy && (
                  <span className="back-test-info-icon" title={selectedStrategy.description}>ⓘ</span>
                )}
              </label>
              <select className="settings-input" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                {strategies.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label className="settings-label">Symbol</label>
              <input
                className="settings-input"
                type="text"
                placeholder="e.g. BTCUSDT"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              />
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

            {strategy === 'rsi-reversal' && (
              <>
                <div className="settings-field">
                  <label className="settings-label">Take Profit (%)</label>
                  <input
                    className="settings-input"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={rsiTpPct}
                    onChange={(e) => setRsiTpPct(Number(e.target.value))}
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-label">Stop Loss (%)</label>
                  <input
                    className="settings-input"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={rsiSlPct}
                    onChange={(e) => setRsiSlPct(Number(e.target.value))}
                  />
                </div>
              </>
            )}

            {strategy === 'fomo-short' && (
              <>
                <div className="settings-field">
                  <label className="settings-label">TP Steps</label>
                  <input
                    className="settings-input"
                    type="number"
                    min={1}
                    value={fomoTpSteps}
                    onChange={(e) => setFomoTpSteps(Number(e.target.value))}
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-label">Entry Hour (UTC)</label>
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    max={23}
                    value={fomoEntryHour}
                    onChange={(e) => setFomoEntryHour(Number(e.target.value))}
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-label">Exit Hour (UTC)</label>
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    max={23}
                    value={fomoExitHour}
                    onChange={(e) => setFomoExitHour(Number(e.target.value))}
                  />
                </div>
              </>
            )}

            {strategy === 'fomo-long' && (
              <>
                <div className="settings-field">
                  <label className="settings-label">TP (%)</label>
                  <input
                    className="settings-input"
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={fomoLongTpPct}
                    onChange={(e) => setFomoLongTpPct(Number(e.target.value))}
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-label">Entry Hour (UTC)</label>
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    max={23}
                    value={fomoEntryHour}
                    onChange={(e) => setFomoEntryHour(Number(e.target.value))}
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-label">Exit Hour (UTC)</label>
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    max={23}
                    value={fomoExitHour}
                    onChange={(e) => setFomoExitHour(Number(e.target.value))}
                  />
                </div>
              </>
            )}

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
              <span className="back-test-metric-sub back-test-metric--positive">
                +{fmt(result.trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0))}
              </span>
              <span className="back-test-metric-sub back-test-metric--negative">
                {fmt(result.trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))}
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
                      <th>Open Date</th>
                      <th>Close Date</th>
                      <th>Entry</th>
                      <th>SL</th>
                      <th>TP</th>
                      <th>Exit</th>
                      <th>Volume</th>
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
                        <td className="back-test-date">{fmtDate(trade.entryTime)}</td>
                        <td className="back-test-date">{fmtDate(trade.exitTime)}</td>
                        <td>{fmt(trade.entryPrice)}</td>
                        <td className="back-test-metric--negative">{fmt(trade.stopLoss)}</td>
                        <td className="back-test-metric--positive">{fmt(trade.takeProfit)}</td>
                        <td>{fmt(trade.exitPrice)}</td>
                        <td>{fmt(trade.size * trade.entryPrice)}</td>
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
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <>
                    <tr
                      key={r.id}
                      className={`back-test-history-row${selectedResult?.id === r.id ? ' back-test-history-row--active' : ''}`}
                      onClick={() => { void handleSelectResult(r.id); }}
                      title="Click to view trade detail"
                    >
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
                      <td>{loadingId === r.id ? '…' : selectedResult?.id === r.id ? '▲' : '▼'}</td>
                      <td>
                        <button
                          className="btn btn--danger btn--sm"
                          disabled={deletingId === r.id}
                          onClick={(e) => { e.stopPropagation(); void handleDeleteResult(r.id); }}
                          title="Delete this result"
                        >
                          {deletingId === r.id ? '…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                    {selectedResult?.id === r.id && (
                      <tr key={`${r.id}-detail`}>
                        <td colSpan={10} className="back-test-history-detail">
                          {selectedResult.trades.length === 0 ? (
                            <p className="back-test-empty">No trades recorded.</p>
                          ) : (
                            <table className="back-test-trades-table">
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>Dir</th>
                                  <th>Open Date</th>
                                  <th>Close Date</th>
                                  <th>Entry</th>
                                  <th>SL</th>
                                  <th>TP</th>
                                  <th>Exit</th>
                                  <th>Volume</th>
                                  <th>PnL</th>
                                  <th>PnL %</th>
                                  <th>Outcome</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedResult.trades.map((trade, i) => (
                                  <tr key={i} className={`back-test-trade-row back-test-trade-row--${trade.outcome}`}>
                                    <td>{i + 1}</td>
                                    <td className={`back-test-direction back-test-direction--${trade.direction}`}>{trade.direction}</td>
                                    <td className="back-test-date">{fmtDate(trade.entryTime)}</td>
                                    <td className="back-test-date">{fmtDate(trade.exitTime)}</td>
                                    <td>{fmt(trade.entryPrice)}</td>
                                    <td className="back-test-metric--negative">{fmt(trade.stopLoss)}</td>
                                    <td className="back-test-metric--positive">{fmt(trade.takeProfit)}</td>
                                    <td>{fmt(trade.exitPrice)}</td>
                                    <td>{fmt(trade.size * trade.entryPrice)}</td>
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
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
