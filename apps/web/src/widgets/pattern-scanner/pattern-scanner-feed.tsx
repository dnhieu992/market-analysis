'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { PatternKind, PatternWatchCoin, PatternScanResult, PatternMatch } from '@web/shared/api/types';

const PATTERN_META: Record<PatternKind, { label: string; dir: 'bullish' | 'bearish' }> = {
  double_bottom: { label: 'Hai đáy', dir: 'bullish' },
  inverse_head_shoulders: { label: 'Vai đầu vai ngược', dir: 'bullish' },
  double_top: { label: 'Hai đỉnh', dir: 'bearish' },
  head_shoulders: { label: 'Vai đầu vai', dir: 'bearish' },
};

const PATTERN_ORDER: PatternKind[] = ['double_bottom', 'double_top', 'head_shoulders', 'inverse_head_shoulders'];

const TIMEFRAMES = [
  { value: '1d', label: 'D1 (ngày)' },
  { value: '4h', label: 'H4' },
  { value: '1w', label: 'W1 (tuần)' },
  { value: '1h', label: 'H1' },
];

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(8);
}

const apiClient = createApiClient();

export function PatternScannerFeed({ initialCoins }: { initialCoins: PatternWatchCoin[] }) {
  const [coins, setCoins] = useState<PatternWatchCoin[]>(initialCoins);
  const [selected, setSelected] = useState<Set<PatternKind>>(new Set(PATTERN_ORDER));
  const [timeframe, setTimeframe] = useState('1d');
  const [newSymbol, setNewSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<PatternScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function togglePattern(p: PatternKind) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    setAdding(true);
    setError(null);
    try {
      const coin = await apiClient.addPatternCoin(sym);
      setCoins((prev) => (prev.some((c) => c.symbol === coin.symbol) ? prev : [...prev, coin]));
      setNewSymbol('');
    } catch {
      setError(`Không thêm được ${sym}.`);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(symbol: string) {
    try {
      await apiClient.removePatternCoin(symbol);
      setCoins((prev) => prev.filter((c) => c.symbol !== symbol));
    } catch { /* ignore */ }
  }

  async function handleScan() {
    if (selected.size === 0) { setError('Chọn ít nhất 1 pattern.'); return; }
    if (coins.length === 0) { setError('Watchlist trống — thêm coin trước.'); return; }
    setScanning(true);
    setError(null);
    try {
      const patterns = PATTERN_ORDER.filter((p) => selected.has(p));
      const res = await apiClient.scanPatterns(patterns, timeframe);
      setResult(res);
    } catch {
      setError('Scan lỗi. Thử lại.');
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="ps">
      <header className="ps-header">
        <h1 className="ps-title">Pattern Scanner</h1>
        <p className="ps-sub">Quét watchlist theo mô hình giá (2 đáy, 2 đỉnh, vai đầu vai…) để lọc coin đáng chú ý.</p>
      </header>

      {/* Watchlist */}
      <section className="ps-card">
        <div className="ps-card-head">
          <h2>Watchlist <span className="ps-count">{coins.length}</span></h2>
          <form className="ps-add" onSubmit={handleAdd}>
            <input
              className="setup-input"
              placeholder="Mã coin (VD: BTC)"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
            />
            <button className="btn btn--primary" type="submit" disabled={adding}>+ Thêm</button>
          </form>
        </div>
        {coins.length === 0 ? (
          <p className="scr-muted">Chưa có coin. Thêm mã để bắt đầu.</p>
        ) : (
          <div className="ps-chips">
            {coins.map((c) => (
              <span key={c.id} className="ps-chip">
                {c.symbol}
                <button className="ps-chip-x" onClick={() => handleRemove(c.symbol)} aria-label={`Xóa ${c.symbol}`}>✕</button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Controls */}
      <section className="ps-card">
        <h2>Pattern cần quét</h2>
        <div className="ps-patterns">
          {PATTERN_ORDER.map((p) => {
            const m = PATTERN_META[p];
            return (
              <label key={p} className={`ps-check ps-check--${m.dir}`}>
                <input type="checkbox" checked={selected.has(p)} onChange={() => togglePattern(p)} />
                <span>{m.label}</span>
                <span className={`ps-dir ps-dir--${m.dir}`}>{m.dir === 'bullish' ? '↑' : '↓'}</span>
              </label>
            );
          })}
        </div>
        <div className="ps-actions">
          <label className="ps-tf">
            Khung
            <select className="setup-input" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              {TIMEFRAMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button className="btn btn--primary ps-scan" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Đang quét…' : '🔍 Scan'}
          </button>
        </div>
        {error && <p className="scr-muted ord-error">{error}</p>}
      </section>

      {/* Results */}
      {result && (
        <section className="ps-card">
          <div className="ps-card-head">
            <h2>Kết quả <span className="ps-count">{result.coins.length}</span></h2>
            <span className="scr-muted">
              {result.scanned} coin · {result.timeframe.toUpperCase()} · {new Date(result.scannedAt).toLocaleString('vi-VN')}
              {result.failed > 0 && ` · ${result.failed} lỗi`}
            </span>
          </div>
          {result.coins.length === 0 ? (
            <p className="scr-muted">Không coin nào khớp pattern đã chọn.</p>
          ) : (
            <div className="ps-results">
              {result.coins.map((coin) => (
                <div key={coin.symbol} className="ps-result">
                  <div className="ps-result-head">
                    <span className="scr-symbol">{coin.symbol}</span>
                    <span className="scr-muted">${fmtPrice(coin.price)}</span>
                  </div>
                  <div className="ps-matches">
                    {coin.matches.map((m, i) => <MatchRow key={i} m={m} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MatchRow({ m }: { m: PatternMatch }) {
  const meta = PATTERN_META[m.pattern];
  return (
    <div className={`ps-match ps-match--${m.direction}`}>
      <div className="ps-match-top">
        <span className="ps-match-name">{meta.label}</span>
        <span className={`ps-badge ps-badge--${m.status}`}>{m.status === 'confirmed' ? 'Đã phá neckline' : 'Đang hình thành'}</span>
        <span className={`ps-dir ps-dir--${m.direction}`}>{m.direction === 'bullish' ? 'Tăng ↑' : 'Giảm ↓'}</span>
        <span className="scr-muted ps-match-meta">biên độ {m.heightPct}% · {m.barsAgo} nến trước</span>
      </div>
      <div className="ps-levels">
        <span>Neckline <b>${fmtPrice(m.neckline)}</b></span>
        <span>Target <b>${fmtPrice(m.target)}</b></span>
        <span>Stop <b>${fmtPrice(m.stop)}</b></span>
      </div>
    </div>
  );
}
