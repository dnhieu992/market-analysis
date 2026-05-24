'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ScanResult } from '@web/shared/api/types';

const apiClient = createApiClient();

type Timeframe = '1d' | '4h' | '1w';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1w', label: '1W' },
  { value: '1d', label: '1D' },
  { value: '4h', label: '4H' },
];

type ScannerFeedProps = Readonly<{
  initialWatchlist: string[];
}>;

type ScanStatus = 'idle' | 'scanning' | 'done' | 'error';

const DEFAULT_KEY_VALUE = 3;
const DEFAULT_ATR_PERIOD = 10;

function TrendBadge({ trend }: { trend: 'uptrend' | 'downtrend' }) {
  return (
    <span className={`scanner-trend-badge scanner-trend-badge--${trend}`}>
      {trend === 'uptrend' ? '▲ Uptrend' : '▼ Downtrend'}
    </span>
  );
}

function ScanRow({ result }: { result: ScanResult }) {
  const pct = result.price > 0
    ? (((result.price - result.stopLevel) / result.stopLevel) * 100).toFixed(2)
    : null;

  return (
    <div className={`scanner-row scanner-row--${result.trend}`}>
      <div className="scanner-row-symbol">{result.symbol}</div>
      <TrendBadge trend={result.trend} />
      <div className="scanner-row-price">
        {result.price > 0 ? `$${result.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : '—'}
      </div>
      <div className="scanner-row-stop">
        <span className="scanner-row-stop-label">Stop</span>
        {result.stopLevel > 0
          ? `$${result.stopLevel.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
          : '—'}
        {pct && result.trend === 'uptrend' && (
          <span className="scanner-row-stop-gap">+{pct}%</span>
        )}
      </div>
      {result.error && <div className="scanner-row-error">{result.error}</div>}
    </div>
  );
}

export function ScannerFeed({ initialWatchlist }: ScannerFeedProps) {
  const [watchlist, setWatchlist] = useState<string[]>(initialWatchlist);
  const [symbolInput, setSymbolInput] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [keyValue, setKeyValue] = useState<number>(DEFAULT_KEY_VALUE);
  const [atrPeriod, setAtrPeriod] = useState<number>(DEFAULT_ATR_PERIOD);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  function handleAddSymbol() {
    const trimmed = symbolInput.trim().toUpperCase();
    if (!trimmed || watchlist.includes(trimmed)) return;
    setWatchlist([...watchlist, trimmed]);
    setSymbolInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAddSymbol();
  }

  function handleRemoveSymbol(sym: string) {
    setWatchlist(watchlist.filter((s) => s !== sym));
  }

  async function handleSaveWatchlist() {
    setSaveStatus('saving');
    try {
      const updated = await apiClient.updateScannerWatchlist(watchlist);
      setWatchlist(updated);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
    }
  }

  async function handleScan() {
    if (watchlist.length === 0) return;
    setScanStatus('scanning');
    setResults([]);
    try {
      const data = await apiClient.scanUtBot(watchlist, timeframe, atrPeriod, keyValue);
      setResults(data);
      setScanStatus('done');
    } catch {
      setScanStatus('error');
    }
  }

  const uptrends = results.filter((r) => r.trend === 'uptrend');
  const downtrends = results.filter((r) => r.trend === 'downtrend');

  return (
    <main className="dashboard-shell scanner-shell">
      <section className="hero-card scanner-hero">
        <div className="hero-copy">
          <p className="eyebrow">Scanner</p>
          <h1>UT Bot Scanner</h1>
          <p className="lead">Scan your watchlist for uptrend/downtrend signals using the UT Bot trailing stop indicator.</p>
        </div>
        {results.length > 0 && (
          <div className="scanner-hero-stats">
            <div className="scanner-stat scanner-stat--up">
              <span className="scanner-stat-value">{uptrends.length}</span>
              <span className="scanner-stat-label">Uptrend</span>
            </div>
            <div className="scanner-stat scanner-stat--down">
              <span className="scanner-stat-value">{downtrends.length}</span>
              <span className="scanner-stat-label">Downtrend</span>
            </div>
          </div>
        )}
      </section>

      <section className="settings-card">
        <p className="settings-card-title">Watchlist</p>
        <div className="settings-fields">
          <div className="settings-field">
            <label className="settings-label">Symbols</label>
            <div className="settings-symbol-list">
              {watchlist.length === 0
                ? <span className="settings-symbol-list-empty">No symbols — add one below</span>
                : watchlist.map((sym) => (
                    <span key={sym} className="settings-symbol-tag">
                      {sym}
                      <button
                        className="settings-symbol-remove"
                        onClick={() => handleRemoveSymbol(sym)}
                        aria-label={`Remove ${sym}`}
                      >×</button>
                    </span>
                  ))
              }
            </div>
          </div>

          <div className="settings-symbol-add">
            <input
              className="settings-input"
              type="text"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="e.g. BTCUSDT"
            />
            <button className="scanner-btn scanner-btn--add" onClick={handleAddSymbol}>
              Add
            </button>
          </div>

          <div className="settings-actions">
            <button
              className="scanner-btn scanner-btn--save"
              onClick={handleSaveWatchlist}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save Watchlist'}
            </button>
            {saveStatus === 'saved' && <span className="settings-status settings-status--success">✓ Saved</span>}
            {saveStatus === 'error' && <span className="settings-status settings-status--error">Save failed</span>}
          </div>
        </div>
      </section>

      <section className="scanner-actions-bar">
        <div className="scanner-tf-selector">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={`scanner-tf-btn${timeframe === tf.value ? ' scanner-tf-btn--active' : ''}`}
              onClick={() => setTimeframe(tf.value)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="scanner-utbot-params">
          <label className="scanner-param-label">
            Key Value
            <input
              className="scanner-param-input"
              type="number"
              min={0.1}
              max={20}
              step={0.5}
              value={keyValue}
              onChange={(e) => setKeyValue(Number(e.target.value))}
              title="UT Bot Key Value (ATR multiplier)"
            />
          </label>
          <label className="scanner-param-label">
            ATR Period
            <input
              className="scanner-param-input"
              type="number"
              min={1}
              max={200}
              step={1}
              value={atrPeriod}
              onChange={(e) => setAtrPeriod(Number(e.target.value))}
              title="UT Bot ATR Period"
            />
          </label>
        </div>

        <button
          className="scanner-btn scanner-btn--scan"
          onClick={handleScan}
          disabled={watchlist.length === 0 || scanStatus === 'scanning'}
        >
          {scanStatus === 'scanning' ? 'Scanning…' : `Scan ${watchlist.length} Coin${watchlist.length !== 1 ? 's' : ''}`}
        </button>
        {scanStatus === 'error' && <span className="settings-status settings-status--error">Scan failed</span>}
      </section>

      {scanStatus === 'scanning' && (
        <section className="scanner-loading">
          <div className="scanner-loading-spinner" />
          <p>Fetching candles and computing UT Bot trailing stop ({timeframe.toUpperCase()})…</p>
        </section>
      )}

      {results.length > 0 && (
        <>
          {uptrends.length > 0 && (
            <section className="settings-card scanner-results-section">
              <p className="settings-card-title scanner-results-title scanner-results-title--up">
                ▲ Uptrend ({uptrends.length})
              </p>
              <div className="scanner-rows">
                {uptrends.map((r) => <ScanRow key={r.symbol} result={r} />)}
              </div>
            </section>
          )}

          {downtrends.length > 0 && (
            <section className="settings-card scanner-results-section">
              <p className="settings-card-title scanner-results-title scanner-results-title--down">
                ▼ Downtrend ({downtrends.length})
              </p>
              <div className="scanner-rows">
                {downtrends.map((r) => <ScanRow key={r.symbol} result={r} />)}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
