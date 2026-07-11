'use client';

import { useMemo, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { SpotFlipAnalysis } from '@web/shared/api/types';

/* ── constants ──────────────────────────────────────────────────
 * Fee is 0.05%/side = 0.10% round-trip (user's real Binance spot fee).
 * Default TP/SL are derived from ATR% so targets stay inside the coin's
 * usual daily range — the core "lướt spot" rule: don't aim past what the
 * coin normally moves in a session. */
const FEE_ROUND_TRIP = 0.1;
const TP_ATR_MULT = 0.8; // suggested take-profit = 0.8 × daily range
const SL_ATR_MULT = 0.6; // suggested stop-loss   = 0.6 × daily range

const apiClient = createApiClient();

const QUICK_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];

/* ── formatting ─────────────────────────────────────────────── */

function fmtPrice(price: number): string {
  if (!Number.isFinite(price)) return '—';
  if (price >= 100) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(8);
}

function fmtPct(value: number | null, withSign = true): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = withSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function pctClass(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'sf-neutral';
  if (value > 0) return 'sf-up';
  if (value < 0) return 'sf-down';
  return 'sf-neutral';
}

/* ── change cell ────────────────────────────────────────────── */

function ChangeCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="sf-change">
      <span className="sf-change-label">{label}</span>
      <span className={`sf-change-value ${pctClass(value)}`}>{fmtPct(value)}</span>
    </div>
  );
}

/* ── component ──────────────────────────────────────────────── */

export function SpotFlipTool() {
  const [symbolInput, setSymbolInput] = useState('');
  const [data, setData] = useState<SpotFlipAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculator inputs (strings so they can be edited freely).
  const [entry, setEntry] = useState('');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [capital, setCapital] = useState('1000');

  async function analyze(sym: string) {
    const symbol = sym.trim();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.analyzeSpotFlip(symbol);
      setData(result);
      // Seed the calculator from the fresh market data.
      const atr = result.atrPct / 100;
      setEntry(String(result.price));
      setTp(String(result.price * (1 + TP_ATR_MULT * atr)));
      setSl(String(result.price * (1 - SL_ATR_MULT * atr)));
    } catch {
      setData(null);
      setError('Không tải được dữ liệu. Kiểm tra lại mã coin (VD: BTC, SOL, PEPE).');
    } finally {
      setLoading(false);
    }
  }

  /* ── flip math (reactive, net of fees) ── */
  const calc = useMemo(() => {
    const e = parseFloat(entry);
    const t = parseFloat(tp);
    const s = parseFloat(sl);
    const cap = parseFloat(capital);
    if (!Number.isFinite(e) || e <= 0) return null;

    const breakeven = e * (1 + FEE_ROUND_TRIP / 100);

    const tpNetPct = Number.isFinite(t) ? ((t - e) / e) * 100 - FEE_ROUND_TRIP : null;
    const slNetPct = Number.isFinite(s) ? ((s - e) / e) * 100 - FEE_ROUND_TRIP : null; // negative = loss
    const rr = Number.isFinite(t) && Number.isFinite(s) && e > s ? (t - e) / (e - s) : null;

    const profit = tpNetPct != null && Number.isFinite(cap) ? (cap * tpNetPct) / 100 : null;
    const lossAmt = slNetPct != null && Number.isFinite(cap) ? (cap * slNetPct) / 100 : null;

    return { breakeven, tpNetPct, slNetPct, rr, profit, lossAmt };
  }, [entry, tp, sl, capital]);

  // How deep the current dip is, measured in daily-range units (ATR).
  const dipInAtr = data && data.atrPct > 0 ? data.pullbackPct / data.atrPct : null;

  return (
    <div className="sf-page">
      <header className="sf-header">
        <h1 className="sf-title">Spot Flip</h1>
        <p className="sf-subtitle">
          Tính biến động &amp; điểm vào/chốt cho lướt spot — momentum, độ sâu nhịp chỉnh, biên độ ngày (ATR),
          gợi ý TP/SL &amp; lãi net phí (0.05%/chiều).
        </p>
      </header>

      {/* ── search ── */}
      <div className="sf-search">
        <input
          className="sf-search-input"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') analyze(symbolInput); }}
          placeholder="Nhập mã coin, VD: BTC, SOL, PEPE…"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="sf-search-btn" onClick={() => analyze(symbolInput)} disabled={loading}>
          {loading ? 'Đang tải…' : 'Phân tích'}
        </button>
      </div>
      <div className="sf-chips">
        {QUICK_SYMBOLS.map((s) => (
          <button key={s} className="sf-chip" onClick={() => { setSymbolInput(s); analyze(s); }}>
            {s}
          </button>
        ))}
      </div>

      {error && <p className="sf-error">{error}</p>}

      {data && (
        <>
          {/* ── price + momentum ── */}
          <section className="sf-card">
            <div className="sf-price-row">
              <div>
                <span className="sf-coin">{data.symbol}</span>
                <span className="sf-price">${fmtPrice(data.price)}</span>
              </div>
              <span className={`sf-day-badge ${pctClass(data.changes.h24)}`}>{fmtPct(data.changes.h24)} · 24h</span>
            </div>
            <div className="sf-changes">
              <ChangeCell label="1H" value={data.changes.h1} />
              <ChangeCell label="4H" value={data.changes.h4} />
              <ChangeCell label="24H" value={data.changes.h24} />
              <ChangeCell label="7D" value={data.changes.d7} />
              <ChangeCell label="30D" value={data.changes.d30} />
            </div>
          </section>

          {/* ── range / dip / atr ── */}
          <section className="sf-card">
            <h2 className="sf-card-title">Vị trí trong biên 30 ngày</h2>
            <div className="sf-metrics">
              <div className="sf-metric">
                <span className="sf-metric-label">Cách đỉnh (dip)</span>
                <span className="sf-metric-value sf-down">−{data.pullbackPct.toFixed(2)}%</span>
                <span className="sf-metric-sub">đỉnh ${fmtPrice(data.high30d)}</span>
              </div>
              <div className="sf-metric">
                <span className="sf-metric-label">Trên đáy</span>
                <span className="sf-metric-value sf-up">+{data.reboundPct.toFixed(2)}%</span>
                <span className="sf-metric-sub">đáy ${fmtPrice(data.low30d)}</span>
              </div>
              <div className="sf-metric">
                <span className="sf-metric-label">Biên ngày (ATR)</span>
                <span className="sf-metric-value sf-neutral">{data.atrPct.toFixed(2)}%</span>
                <span className="sf-metric-sub">TB 14 ngày</span>
              </div>
              <div className="sf-metric">
                <span className="sf-metric-label">Độ sâu nhịp chỉnh</span>
                <span className="sf-metric-value sf-neutral">{dipInAtr != null ? `${dipInAtr.toFixed(1)}×` : '—'}</span>
                <span className="sf-metric-sub">lần biên ngày</span>
              </div>
            </div>
            <p className="sf-hint">
              Lướt spot: ưu tiên mua khi giá <b>chỉnh ≥ 1× biên ngày</b> so với đỉnh trong xu hướng tăng, và đặt
              TP <b>không quá 1× biên ngày</b> để dễ khớp.
            </p>
          </section>

          {/* ── flip calculator ── */}
          <section className="sf-card">
            <h2 className="sf-card-title">Máy tính chốt lời (net phí 0.10%)</h2>
            <div className="sf-calc-inputs">
              <label className="sf-field">
                <span>Giá vào</span>
                <input value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" />
              </label>
              <label className="sf-field">
                <span>Chốt lời (TP)</span>
                <input value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" />
              </label>
              <label className="sf-field">
                <span>Cắt lỗ (SL)</span>
                <input value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" />
              </label>
              <label className="sf-field">
                <span>Vốn ($)</span>
                <input value={capital} onChange={(e) => setCapital(e.target.value)} inputMode="decimal" />
              </label>
            </div>

            {calc && (
              <div className="sf-calc-results">
                <div className="sf-result">
                  <span className="sf-result-label">Lãi net @ TP</span>
                  <span className={`sf-result-value ${pctClass(calc.tpNetPct)}`}>{fmtPct(calc.tpNetPct)}</span>
                  {calc.profit != null && (
                    <span className="sf-result-sub">{calc.profit >= 0 ? '+' : ''}${calc.profit.toFixed(2)}</span>
                  )}
                </div>
                <div className="sf-result">
                  <span className="sf-result-label">Lỗ net @ SL</span>
                  <span className={`sf-result-value ${pctClass(calc.slNetPct)}`}>{fmtPct(calc.slNetPct)}</span>
                  {calc.lossAmt != null && (
                    <span className="sf-result-sub">${calc.lossAmt.toFixed(2)}</span>
                  )}
                </div>
                <div className="sf-result">
                  <span className="sf-result-label">R : R</span>
                  <span className={`sf-result-value ${calc.rr != null && calc.rr >= 1.5 ? 'sf-up' : 'sf-neutral'}`}>
                    {calc.rr != null ? `${calc.rr.toFixed(2)} : 1` : '—'}
                  </span>
                  <span className="sf-result-sub">nên ≥ 1.5</span>
                </div>
                <div className="sf-result">
                  <span className="sf-result-label">Giá hoà vốn</span>
                  <span className="sf-result-value sf-neutral">${fmtPrice(calc.breakeven)}</span>
                  <span className="sf-result-sub">đã trừ phí</span>
                </div>
              </div>
            )}
            <p className="sf-hint">
              TP/SL mặc định = {TP_ATR_MULT}× / {SL_ATR_MULT}× biên ngày (ATR) tính từ giá vào — chỉnh tay thoải mái.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
