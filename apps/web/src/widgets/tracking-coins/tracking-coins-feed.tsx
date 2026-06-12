'use client';

import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { resolveApiBaseUrl } from '@web/shared/api/client';
import type { TrackingCoinRow, PaTrend, SwingStructure } from '@web/shared/api/types';

type Props = { initialCoins: TrackingCoinRow[] };
type SortKey = 'rsi' | 'vol' | 'coin';
type BiasFilter = 'all' | 'long' | 'short';

const PAGE_SIZE = 50;

/* ── shared: D1/H4 stacked layout ──────────────────────────────── */

function TfStack({ d1, h4 }: { d1: ReactNode; h4: ReactNode }) {
  return (
    <div className="tc-tf-stack">
      <div className="tc-tf-stack-row">
        <span className="tc-tf-label">D1</span>
        <span className="tc-tf-stack-val">{d1}</span>
      </div>
      <div className="tc-tf-stack-row">
        <span className="tc-tf-label">H4</span>
        <span className="tc-tf-stack-val">{h4}</span>
      </div>
    </div>
  );
}

/* ── UT Bot badge ───────────────────────────────────────────────── */

function UtBotBadge({ bullish }: { bullish: boolean | null }) {
  if (bullish === null) return <span className="scr-muted" style={{ fontSize: '0.75rem' }}>N/A</span>;
  return (
    <span className={`tc-utbot-badge ${bullish ? 'tc-utbot--bull' : 'tc-utbot--bear'}`}>
      {bullish ? '● Bull' : '● Bear'}
    </span>
  );
}

/* ── EMA pips — green above, red below ─────────────────────────── */

function EmaPips({ e34, e89, e200 }: { e34: boolean | null; e89: boolean | null; e200: boolean | null }) {
  const cls = (v: boolean | null) =>
    v === null ? 'scr-pip scr-pip--na' : v ? 'scr-pip scr-pip--on' : 'scr-pip scr-pip--off';
  return (
    <div className="scr-ema-pips">
      <span className={cls(e34)}>34</span>
      <span className={cls(e89)}>89</span>
      <span className={cls(e200)}>200</span>
    </div>
  );
}

/* ── RSI cell ───────────────────────────────────────────────────── */

function RsiCell({ rsi }: { rsi: number | null }) {
  if (rsi == null) return <span className="scr-muted">—</span>;
  const cls =
    rsi > 70 ? 'scr-rsi scr-rsi--hot' :
    rsi < 35 ? 'scr-rsi scr-rsi--cold' :
    rsi >= 35 && rsi <= 60 ? 'scr-rsi scr-rsi--good' :
    'scr-rsi';
  return <span className={cls}>{Math.round(rsi)}</span>;
}

/* ── Vol cell ───────────────────────────────────────────────────── */

function VolCell({ vol }: { vol: number | null }) {
  if (vol == null) return <span className="scr-muted">—</span>;
  const cls = vol >= 1.5 ? 'scr-vol scr-vol--high' : vol >= 1.0 ? 'scr-vol' : 'scr-vol scr-vol--low';
  return <span className={cls}>{vol.toFixed(1)}×</span>;
}

/* ── Trend badge ────────────────────────────────────────────────── */

const TREND_META: Record<PaTrend, { label: string; cls: string; desc: string }> = {
  StrongUp:   { label: '↑↑', cls: 'tc-trend tc-trend--strong-up',   desc: 'Strong Uptrend' },
  Up:         { label: '↑',  cls: 'tc-trend tc-trend--up',          desc: 'Uptrend' },
  Neutral:    { label: '→',  cls: 'tc-trend tc-trend--neutral',     desc: 'Sideways' },
  Down:       { label: '↓',  cls: 'tc-trend tc-trend--down',        desc: 'Downtrend' },
  StrongDown: { label: '↓↓', cls: 'tc-trend tc-trend--strong-down', desc: 'Strong Downtrend' },
};

function TrendBadge({ trend }: { trend: PaTrend }) {
  const m = TREND_META[trend];
  return <span className={m.cls} title={m.desc}>{m.label}</span>;
}

function SwingStructureLabel({ structure }: { structure: SwingStructure }) {
  const map: Record<SwingStructure, { label: string; desc: string }> = {
    HH_HL: { label: 'HH / HL', desc: 'Higher High + Higher Low — bullish' },
    LH_LL: { label: 'LH / LL', desc: 'Lower High + Lower Low — bearish' },
    HH_LL: { label: 'HH / LL', desc: 'Higher High + Lower Low — expanding' },
    LH_HL: { label: 'LH / HL', desc: 'Lower High + Higher Low — coil' },
    Mixed:  { label: 'Mixed',  desc: 'Not enough swing points' },
  };
  const { label, desc } = map[structure];
  return <span className="tc-swing-label" title={desc}>{label}</span>;
}

/* ── Sparkline ──────────────────────────────────────────────────── */

function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <span className="scr-muted">—</span>;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const W = 80; const H = 28;
  const step = W / (prices.length - 1);
  const points = prices.map((p, i) => `${i * step},${H - ((p - min) / range) * H}`).join(' ');
  const isUp = prices[prices.length - 1]! >= prices[0]!;
  return (
    <svg width={W} height={H} className="scr-sparkline" viewBox={`0 0 ${W} ${H}`}>
      <polyline points={points} fill="none" stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SparklineLarge({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <span className="scr-muted">Không có dữ liệu</span>;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const W = 280; const H = 80;
  const step = W / (prices.length - 1);
  const points = prices.map((p, i) => `${i * step},${H - ((p - min) / range) * H}`).join(' ');
  const last = prices[prices.length - 1]!;
  const first = prices[0]!;
  const isUp = last >= first;
  const pct = (((last - first) / first) * 100).toFixed(1);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="tc-detail-spark-svg">
        <polyline points={points} fill="none" stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="tc-detail-spark-pct" style={{ color: isUp ? '#22c55e' : '#ef4444' }}>
        {isUp ? '+' : ''}{pct}% (30 ngày)
      </div>
    </div>
  );
}

/* ── icons ──────────────────────────────────────────────────────── */

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function IconDetail() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/* ── detail modal ───────────────────────────────────────────────── */

function CoinDetailModal({ coin, onClose }: { coin: TrackingCoinRow; onClose: () => void }) {
  const sig = coin.signal;
  const tvUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}USDT`;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog tc-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div className="tc-detail-header-coin">
            <span className="scr-symbol">{coin.symbol}</span>
            {coin.name && <span className="scr-name">{coin.name}</span>}
          </div>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body tc-detail-body">
          {!sig ? (
            <p className="scr-muted" style={{ textAlign: 'center', padding: '24px 0' }}>
              Chưa có dữ liệu. Nhấn ⚡ Re-analyze để quét coin này.
            </p>
          ) : (
            <>
              {/* Indicator rows: D1 / H4 / M30 */}
              <div className="tc-detail-section">
                <div className="tc-detail-label">Indicators per timeframe</div>
                <div className="tc-detail-tf-table">
                  <div className="tc-detail-tf-head">
                    <span />
                    <span>Trend</span>
                    <span>UT Bot</span>
                    <span>EMA</span>
                    <span>RSI</span>
                    <span>Vol×</span>
                  </div>
                  {[
                    { tf: 'D1',  trend: sig.trend,    utBot: sig.utBotD1Bullish, e34: sig.ema34Above,   e89: sig.ema89Above,   e200: sig.ema200Above,  rsi: sig.rsi,    vol: sig.volMultiplier },
                    { tf: 'H4',  trend: sig.h4Trend,  utBot: sig.utBotH4Bullish, e34: sig.h4Ema34Above, e89: sig.h4Ema89Above, e200: sig.h4Ema200Above, rsi: sig.h4Rsi,  vol: sig.h4VolMultiplier },
                    { tf: 'M30', trend: sig.m30Trend, utBot: null,               e34: null,             e89: null,             e200: null,              rsi: null,        vol: null },
                  ].map(r => (
                    <div key={r.tf} className="tc-detail-tf-row">
                      <span className="tc-tf-label tc-tf-label--lg">{r.tf}</span>
                      <TrendBadge trend={r.trend} />
                      <UtBotBadge bullish={r.utBot} />
                      <EmaPips e34={r.e34} e89={r.e89} e200={r.e200} />
                      <RsiCell rsi={r.rsi} />
                      <VolCell vol={r.vol} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="tc-detail-grid">
                <div className="tc-detail-stat">
                  <div className="tc-detail-label">Swing Structure</div>
                  <div className="tc-detail-value"><SwingStructureLabel structure={sig.swingStructure} /></div>
                </div>
              </div>

              <div className="tc-detail-section">
                <div className="tc-detail-label">30 ngày gần nhất</div>
                <div className="tc-detail-sparkline"><SparklineLarge prices={sig.sparkline} /></div>
              </div>

              <div className="tc-detail-footer">
                Cập nhật: {new Date(sig.scannedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
              </div>
            </>
          )}
          <a className="tc-detail-tv-btn" href={tvUrl} target="_blank" rel="noopener noreferrer">
            Mở TradingView ↗
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── confirm remove dialog ──────────────────────────────────────── */

function ConfirmRemoveDialog({ symbol, isRemoving, onConfirm, onCancel }: {
  symbol: string; isRemoving: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Xóa coin</span>
          <button className="dialog-close" onClick={onCancel}>✕</button>
        </div>
        <div className="dialog-body">
          <p className="dialog-confirm-text">Xóa <strong>{symbol}</strong> khỏi danh sách theo dõi?</p>
          <div className="dialog-confirm-actions">
            <button className="btn btn--secondary" onClick={onCancel} disabled={isRemoving}>Hủy</button>
            <button className="btn btn--danger" onClick={onConfirm} disabled={isRemoving}>
              {isRemoving ? 'Đang xóa…' : 'Xóa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── add coin form ──────────────────────────────────────────────── */

function AddCoinForm({ onAdded }: { onAdded: (coin: TrackingCoinRow) => void }) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/tracking-coins/coins`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, name: name.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { id: string; symbol: string; name: string };
      onAdded({ ...data, addedAt: new Date().toISOString(), signal: null });
      setSymbol('');
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thêm coin thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="scr-add-form" onSubmit={handleSubmit}>
      <input className="scr-add-input" placeholder="Symbol (e.g. BTC, ETH)" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
      <input className="scr-add-input scr-add-input--name" placeholder="Tên coin (tuỳ chọn)" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="scr-add-btn" type="submit" disabled={loading}>{loading ? '...' : '+ Thêm'}</button>
      {error && <span className="scr-scan-result" style={{ color: 'var(--color-red, #ef4444)' }}>{error}</span>}
    </form>
  );
}

/* ── main feed ──────────────────────────────────────────────────── */

export function TrackingCoinsFeed({ initialCoins }: Props) {
  const [coins, setCoins] = useState<TrackingCoinRow[]>(initialCoins);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('coin');
  const [biasFilter, setBiasFilter] = useState<BiasFilter>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [confirmRemoveSymbol, setConfirmRemoveSymbol] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<TrackingCoinRow | null>(null);

  useEffect(() => { setPage(1); }, [nameFilter, biasFilter, sortKey]);

  async function reloadCoins() {
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/tracking-coins`, { credentials: 'include' });
      if (!res.ok) return;
      setCoins(await res.json() as TrackingCoinRow[]);
    } catch { /* ignore */ }
  }

  async function handleReanalyze() {
    setReanalyzing(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/tracking-coins/scan`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { scanned: number; failed: number };
        setStatusMsg(`✅ Re-analyze xong: ${data.scanned} coins${data.failed > 0 ? ` (${data.failed} lỗi)` : ''}.`);
        await reloadCoins();
      } else {
        const body = await res.text().catch(() => '');
        setStatusMsg(`❌ Re-analyze thất bại (HTTP ${res.status})${body ? `: ${body.slice(0, 120)}` : ''}.`);
      }
    } catch (err) {
      setStatusMsg(`❌ Không kết nối được server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReanalyzing(false);
    }
  }

  async function handleRemoveCoin(symbol: string) {
    setRemovingSymbol(symbol);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/tracking-coins/coins/${encodeURIComponent(symbol)}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) setCoins((prev) => prev.filter((c) => c.symbol !== symbol));
      else setStatusMsg(`Xóa ${symbol} thất bại.`);
    } catch {
      setStatusMsg(`Xóa ${symbol} thất bại.`);
    } finally {
      setRemovingSymbol(null);
    }
  }

  const sorted = useMemo(() => {
    const q = nameFilter.trim().toUpperCase();
    const filtered = coins.filter((c) => {
      if (q && !c.symbol.includes(q) && !c.name.toUpperCase().includes(q)) return false;
      if (biasFilter === 'long') {
        const t = c.signal?.trend;
        return t === 'Up' || t === 'StrongUp';
      }
      if (biasFilter === 'short') {
        const t = c.signal?.trend;
        return t === 'Down' || t === 'StrongDown';
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === 'rsi') return (b.signal?.rsi ?? 0) - (a.signal?.rsi ?? 0);
      if (sortKey === 'vol') return (b.signal?.volMultiplier ?? 0) - (a.signal?.volMultiplier ?? 0);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [coins, sortKey, biasFilter, nameFilter]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      {selectedCoin && <CoinDetailModal coin={selectedCoin} onClose={() => setSelectedCoin(null)} />}
      {confirmRemoveSymbol && (
        <ConfirmRemoveDialog
          symbol={confirmRemoveSymbol}
          isRemoving={removingSymbol === confirmRemoveSymbol}
          onConfirm={async () => { await handleRemoveCoin(confirmRemoveSymbol); setConfirmRemoveSymbol(null); }}
          onCancel={() => setConfirmRemoveSymbol(null)}
        />
      )}

      <main className="dashboard-shell scr-shell">
        {/* header */}
        <div className="tc-page-header">
          <div className="tc-page-header-left">
            <h1 className="scr-title">Tracking Coins</h1>
            <p className="tc-page-header-sub">
              {sorted.length < coins.length
                ? `${sorted.length} / ${coins.length} coins hiển thị`
                : `${coins.length} coins đang theo dõi`}
            </p>
          </div>
          <div className="scr-toolbar-right">
            <button className="scr-scan-btn" onClick={handleReanalyze} disabled={reanalyzing}>
              {reanalyzing ? 'Đang scan…' : '⚡ Re-analyze'}
            </button>
            <button className="scr-add-toggle" onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? '✕' : '+ Coin'}
            </button>
          </div>
        </div>

        {statusMsg && <p className="scr-scan-result">{statusMsg}</p>}

        {showAddForm && (
          <AddCoinForm
            onAdded={(coin) => {
              setCoins((prev) => prev.some((c) => c.symbol === coin.symbol) ? prev : [...prev, coin]);
              setShowAddForm(false);
            }}
          />
        )}

        {/* filters */}
        <div className="scr-filters">
          <div className="tc-bias-tabs">
            {(['all', 'long', 'short'] as BiasFilter[]).map((b) => (
              <button
                key={b}
                className={`tc-bias-tab tc-bias-tab--${b}${biasFilter === b ? ' tc-bias-tab--active' : ''}`}
                onClick={() => setBiasFilter(b)}
              >
                {b === 'all' ? 'Tất cả' : b === 'long' ? '▲ Long bias' : '▼ Short bias'}
              </button>
            ))}
          </div>
          <input
            className="scr-search"
            type="search"
            placeholder="Tìm symbol / tên…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
        </div>

        {/* table */}
        <div className="scr-table-wrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th className="scr-th scr-th--coin" onClick={() => setSortKey('coin')}>
                  Coin {sortKey === 'coin' && '↑'}
                </th>
                <th className="scr-th tc-th--stacked">Trend</th>
                <th className="scr-th tc-th--stacked">UT Bot</th>
                <th className="scr-th tc-th--stacked">EMA</th>
                <th className="scr-th tc-th--stacked" onClick={() => setSortKey('rsi')}>
                  RSI {sortKey === 'rsi' && '↓'}
                </th>
                <th className="scr-th tc-th--stacked" onClick={() => setSortKey('vol')}>
                  Vol× {sortKey === 'vol' && '↓'}
                </th>
                <th className="scr-th">30d</th>
                <th className="scr-th scr-th--num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="scr-empty">
                    {coins.length === 0
                      ? 'Chưa có coin nào. Nhấn "+ Coin" để thêm.'
                      : nameFilter
                      ? `Không tìm thấy coin khớp với "${nameFilter}".`
                      : 'Không có coin nào khớp filter.'}
                  </td>
                </tr>
              )}
              {paginated.map((coin) => {
                const sig = coin.signal;
                return (
                  <tr key={coin.id} className="scr-row" onClick={() => setSelectedCoin(coin)} style={{ cursor: 'pointer' }}>
                    <td className="scr-td scr-td--coin">
                      <span className="scr-symbol">{coin.symbol}</span>
                      {coin.name && <span className="scr-name">{coin.name}</span>}
                    </td>
                    {/* Trend D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            d1={<TrendBadge trend={sig.trend} />}
                            h4={<TrendBadge trend={sig.h4Trend} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    {/* UT Bot D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            d1={<UtBotBadge bullish={sig.utBotD1Bullish} />}
                            h4={<UtBotBadge bullish={sig.utBotH4Bullish} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    {/* EMA D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            d1={<EmaPips e34={sig.ema34Above} e89={sig.ema89Above} e200={sig.ema200Above} />}
                            h4={<EmaPips e34={sig.h4Ema34Above} e89={sig.h4Ema89Above} e200={sig.h4Ema200Above} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    {/* RSI D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            d1={<RsiCell rsi={sig.rsi} />}
                            h4={<RsiCell rsi={sig.h4Rsi} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    {/* Vol D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            d1={<VolCell vol={sig.volMultiplier} />}
                            h4={<VolCell vol={sig.h4VolMultiplier} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    <td className="scr-td scr-td--sparkline">
                      <Sparkline prices={sig?.sparkline ?? []} />
                    </td>
                    <td className="scr-td scr-td--num" onClick={(e) => e.stopPropagation()}>
                      <div className="tt-actions">
                        <button className="tt-btn tt-btn--notes" data-tooltip="Chi tiết" aria-label={`Chi tiết ${coin.symbol}`} onClick={() => setSelectedCoin(coin)}>
                          <IconDetail />
                        </button>
                        <button className="tt-btn tt-btn--danger" data-tooltip="Xóa" aria-label={`Xóa ${coin.symbol}`} onClick={() => setConfirmRemoveSymbol(coin.symbol)} disabled={removingSymbol === coin.symbol}>
                          {removingSymbol === coin.symbol ? '…' : <IconTrash />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {totalPages > 1 && (
          <div className="scr-pagination">
            <button className="scr-page-btn" onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
            <button className="scr-page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>‹</button>
            <span className="scr-page-info">
              Trang {safePage} / {totalPages}
              <span className="scr-page-sub">&nbsp;({(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} / {sorted.length})</span>
            </span>
            <button className="scr-page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>›</button>
            <button className="scr-page-btn" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</button>
          </div>
        )}
      </main>
    </>
  );
}
