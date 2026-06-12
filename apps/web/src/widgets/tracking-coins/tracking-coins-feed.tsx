'use client';

import { useState, useMemo, useEffect } from 'react';
import { resolveApiBaseUrl } from '@web/shared/api/client';
import type { TrackingCoinRow, TradeSetup, PaTrend, SwingStructure } from '@web/shared/api/types';

type Props = { initialCoins: TrackingCoinRow[] };
type SortKey = 'setup' | 'rsi' | 'vol' | 'coin';

const ALL_SETUPS: TradeSetup[] = ['LongSwing', 'ShortSwing', 'LongScalp', 'ShortScalp', 'Neutral'];

const SETUP_META: Record<TradeSetup, { label: string; cls: string; desc: string; priority: number }> = {
  LongSwing:  { label: '▲ Long Swing',  cls: 'tc-setup tc-setup--long-swing',  desc: 'D1 + H4 uptrend — swing long opportunity',   priority: 5 },
  ShortSwing: { label: '▼ Short Swing', cls: 'tc-setup tc-setup--short-swing', desc: 'D1 + H4 downtrend — swing short opportunity', priority: 4 },
  LongScalp:  { label: '↑ Long Scalp',  cls: 'tc-setup tc-setup--long-scalp',  desc: 'H4 + M30 uptrend — intraday long setup',     priority: 3 },
  ShortScalp: { label: '↓ Short Scalp', cls: 'tc-setup tc-setup--short-scalp', desc: 'H4 + M30 downtrend — intraday short setup',  priority: 2 },
  Neutral:    { label: '— Neutral',      cls: 'tc-setup tc-setup--neutral',     desc: 'Conflicting signals — no clear setup',       priority: 1 },
};

const TREND_META: Record<PaTrend, { label: string; cls: string; desc: string }> = {
  StrongUp:   { label: '↑↑', cls: 'tc-trend tc-trend--strong-up',   desc: 'Strong Uptrend' },
  Up:         { label: '↑',  cls: 'tc-trend tc-trend--up',          desc: 'Uptrend' },
  Neutral:    { label: '→',  cls: 'tc-trend tc-trend--neutral',     desc: 'Sideways' },
  Down:       { label: '↓',  cls: 'tc-trend tc-trend--down',        desc: 'Downtrend' },
  StrongDown: { label: '↓↓', cls: 'tc-trend tc-trend--strong-down', desc: 'Strong Downtrend' },
};

const PAGE_SIZE = 50;

/* ── badges & cells ────────────────────────────────────────────── */

function SetupBadge({ setup }: { setup: TradeSetup }) {
  const meta = SETUP_META[setup];
  return <span className={meta.cls} title={meta.desc}>{meta.label}</span>;
}

function TrendBadge({ trend }: { trend: PaTrend }) {
  const meta = TREND_META[trend];
  return <span className={meta.cls} title={meta.desc}>{meta.label}</span>;
}

function MultiTrendCell({ d1, h4, m30 }: { d1: PaTrend; h4: PaTrend; m30: PaTrend }) {
  return (
    <div className="tc-multi-trend">
      <div className="tc-multi-trend-row"><span className="tc-tf-label">D1</span><TrendBadge trend={d1} /></div>
      <div className="tc-multi-trend-row"><span className="tc-tf-label">H4</span><TrendBadge trend={h4} /></div>
      <div className="tc-multi-trend-row"><span className="tc-tf-label">M30</span><TrendBadge trend={m30} /></div>
    </div>
  );
}

function SwingStructureLabel({ structure }: { structure: SwingStructure }) {
  const map: Record<SwingStructure, { label: string; desc: string }> = {
    HH_HL: { label: 'HH / HL', desc: 'Higher High + Higher Low — bullish structure' },
    LH_LL: { label: 'LH / LL', desc: 'Lower High + Lower Low — bearish structure' },
    HH_LL: { label: 'HH / LL', desc: 'Higher High + Lower Low — expanding range' },
    LH_HL: { label: 'LH / HL', desc: 'Lower High + Higher Low — compression / coil' },
    Mixed: { label: 'Mixed',   desc: 'Not enough swing points detected' },
  };
  const { label, desc } = map[structure];
  return <span className="tc-swing-label" title={desc}>{label}</span>;
}

function RsiCell({ rsi }: { rsi: number | null }) {
  if (rsi == null) return <span className="scr-muted">—</span>;
  const cls =
    rsi > 70 ? 'scr-rsi scr-rsi--hot' :
    rsi < 35 ? 'scr-rsi scr-rsi--cold' :
    rsi >= 35 && rsi <= 60 ? 'scr-rsi scr-rsi--good' :
    'scr-rsi';
  return <span className={cls}>{Math.round(rsi)}</span>;
}

function VolCell({ vol }: { vol: number | null }) {
  if (vol == null) return <span className="scr-muted">—</span>;
  const cls = vol >= 1.5 ? 'scr-vol scr-vol--high' : vol >= 1.0 ? 'scr-vol' : 'scr-vol scr-vol--low';
  return <span className={cls}>{vol.toFixed(1)}×</span>;
}

function EmaPips({ ema34Above, ema89Above, ema200Above }: { ema34Above: boolean; ema89Above: boolean; ema200Above: boolean }) {
  return (
    <div className="scr-ema-pips">
      <span className={`scr-pip${ema34Above ? ' scr-pip--on' : ''}`}>34</span>
      <span className={`scr-pip${ema89Above ? ' scr-pip--on' : ''}`}>89</span>
      <span className={`scr-pip${ema200Above ? ' scr-pip--on' : ''}`}>200</span>
    </div>
  );
}

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

function CoinDetailModal({ coin, onClose }: { coin: TrackingCoinRow; onClose: () => void }) {
  const sig = coin.signal;
  const setup = sig?.setup ?? 'Neutral';
  const tvUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}USDT`;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog tc-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div className="tc-detail-header-coin">
            <span className="scr-symbol">{coin.symbol}</span>
            {coin.name && <span className="scr-name">{coin.name}</span>}
            {sig && <SetupBadge setup={setup} />}
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
              <div className="tc-detail-section">
                <div className="tc-detail-label">Trade Setup</div>
                <div style={{ marginTop: 6 }}>
                  <SetupBadge setup={setup} />
                  <span className="scr-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                    {SETUP_META[setup].desc}
                  </span>
                </div>
              </div>

              <div className="tc-detail-grid">
                <div className="tc-detail-stat tc-detail-stat--full">
                  <div className="tc-detail-label">Trend (D1 / H4 / M30)</div>
                  <div className="tc-detail-trend-row">
                    {([['D1', sig.trend], ['H4', sig.h4Trend], ['M30', sig.m30Trend]] as [string, PaTrend][]).map(([tf, t]) => (
                      <div key={tf} className="tc-detail-trend-item">
                        <span className="tc-tf-label tc-tf-label--lg">{tf}</span>
                        <TrendBadge trend={t} />
                        <span className="tc-detail-trend-desc">{TREND_META[t].desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="tc-detail-stat">
                  <div className="tc-detail-label">Swing Structure</div>
                  <div className="tc-detail-value"><SwingStructureLabel structure={sig.swingStructure} /></div>
                </div>
                <div className="tc-detail-stat">
                  <div className="tc-detail-label">RSI (14)</div>
                  <div className="tc-detail-value"><RsiCell rsi={sig.rsi} /></div>
                </div>
                <div className="tc-detail-stat">
                  <div className="tc-detail-label">Vol×</div>
                  <div className="tc-detail-value"><VolCell vol={sig.volMultiplier} /></div>
                </div>
                <div className="tc-detail-stat">
                  <div className="tc-detail-label">vs EMA</div>
                  <div className="tc-detail-value">
                    <EmaPips ema34Above={sig.ema34Above} ema89Above={sig.ema89Above} ema200Above={sig.ema200Above} />
                  </div>
                </div>
                <div className="tc-detail-stat">
                  <div className="tc-detail-label">Signal Score</div>
                  <div className="tc-detail-value">{sig.signalScore}</div>
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

/* ── setup info popover ─────────────────────────────────────────── */

function SetupInfoPopover({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="tc-info-popover-backdrop" onClick={onClose} />
      <div className="tc-info-popover">
        <p className="tc-info-popover-title">Giải thích Setup</p>
        {ALL_SETUPS.map((setup) => {
          const meta = SETUP_META[setup];
          return (
            <div key={setup} className="tc-info-popover-row">
              <span className={meta.cls}>{meta.label}</span>
              <span className="tc-info-popover-desc">{meta.desc}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── main feed ──────────────────────────────────────────────────── */

export function TrackingCoinsFeed({ initialCoins }: Props) {
  const [coins, setCoins] = useState<TrackingCoinRow[]>(initialCoins);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('setup');
  const [hiddenSetups, setHiddenSetups] = useState<Set<TradeSetup>>(new Set<TradeSetup>());
  const [showAddForm, setShowAddForm] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [confirmRemoveSymbol, setConfirmRemoveSymbol] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<TrackingCoinRow | null>(null);
  const [showSetupInfo, setShowSetupInfo] = useState(false);

  function toggleSetup(setup: TradeSetup) {
    setHiddenSetups((prev) => {
      const next = new Set(prev);
      if (next.has(setup)) next.delete(setup); else next.add(setup);
      return next;
    });
  }

  useEffect(() => { setPage(1); }, [nameFilter, hiddenSetups, sortKey]);

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
      if (c.signal === null) return true;
      return !hiddenSetups.has(c.signal.setup);
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === 'setup') {
        const pa = SETUP_META[a.signal?.setup ?? 'Neutral'].priority;
        const pb = SETUP_META[b.signal?.setup ?? 'Neutral'].priority;
        if (pb !== pa) return pb - pa;
        return (b.signal?.signalScore ?? 0) - (a.signal?.signalScore ?? 0);
      }
      if (sortKey === 'rsi') return (b.signal?.rsi ?? 0) - (a.signal?.rsi ?? 0);
      if (sortKey === 'vol') return (b.signal?.volMultiplier ?? 0) - (a.signal?.volMultiplier ?? 0);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [coins, sortKey, hiddenSetups, nameFilter]);

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
        {/* ── page header ── */}
        <div className="tc-page-header">
          <div className="tc-page-header-left">
            <div className="tc-page-title-row">
              <h1 className="scr-title">Tracking Coins</h1>
              <div className="tc-info-wrap">
                <button
                  className={`tc-info-btn${showSetupInfo ? ' tc-info-btn--active' : ''}`}
                  onClick={() => setShowSetupInfo((v) => !v)}
                  aria-label="Giải thích các setup"
                >
                  i
                </button>
                {showSetupInfo && <SetupInfoPopover onClose={() => setShowSetupInfo(false)} />}
              </div>
            </div>
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

        {/* ── filters ── */}
        <div className="scr-filters">
          {ALL_SETUPS.map((setup) => {
            const meta = SETUP_META[setup];
            return (
              <button
                key={setup}
                className={`tc-setup-chip tc-setup-chip--${setup.toLowerCase()}${hiddenSetups.has(setup) ? ' tc-setup-chip--off' : ''}`}
                onClick={() => toggleSetup(setup)}
              >
                {meta.label}
              </button>
            );
          })}
          <input
            className="scr-search"
            type="search"
            placeholder="Tìm symbol / tên…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
        </div>

        {/* ── table ── */}
        <div className="scr-table-wrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th className="scr-th scr-th--coin" onClick={() => setSortKey('coin')}>
                  Coin {sortKey === 'coin' && '↑'}
                </th>
                <th className="scr-th" onClick={() => setSortKey('setup')}>
                  Setup {sortKey === 'setup' && '↓'}
                </th>
                <th className="scr-th">Trend (D1/H4/M30)</th>
                <th className="scr-th scr-th--num" onClick={() => setSortKey('rsi')}>
                  RSI {sortKey === 'rsi' && '↓'}
                </th>
                <th className="scr-th scr-th--num" onClick={() => setSortKey('vol')}>
                  Vol× {sortKey === 'vol' && '↓'}
                </th>
                <th className="scr-th">vs EMA</th>
                <th className="scr-th">Structure</th>
                <th className="scr-th">30d</th>
                <th className="scr-th scr-th--num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="scr-empty">
                    {coins.length === 0
                      ? 'Chưa có coin nào. Nhấn "+ Coin" để thêm coin muốn theo dõi.'
                      : nameFilter
                      ? `Không tìm thấy coin khớp với "${nameFilter}".`
                      : 'Tất cả setups đang bị ẩn bởi filter.'}
                  </td>
                </tr>
              )}
              {paginated.map((coin) => {
                const sig = coin.signal;
                const setup = sig?.setup ?? 'Neutral';
                return (
                  <tr key={coin.id} className="scr-row" onClick={() => setSelectedCoin(coin)} style={{ cursor: 'pointer' }}>
                    <td className="scr-td scr-td--coin">
                      <span className="scr-symbol">{coin.symbol}</span>
                      {coin.name && <span className="scr-name">{coin.name}</span>}
                    </td>
                    <td className="scr-td">
                      {sig ? <SetupBadge setup={setup} /> : <span className="scr-muted">—</span>}
                    </td>
                    <td className="scr-td scr-td--trend">
                      {sig
                        ? <MultiTrendCell d1={sig.trend} h4={sig.h4Trend} m30={sig.m30Trend} />
                        : <span className="scr-muted">—</span>}
                    </td>
                    <td className="scr-td scr-td--num"><RsiCell rsi={sig?.rsi ?? null} /></td>
                    <td className="scr-td scr-td--num"><VolCell vol={sig?.volMultiplier ?? null} /></td>
                    <td className="scr-td">
                      {sig
                        ? <EmaPips ema34Above={sig.ema34Above} ema89Above={sig.ema89Above} ema200Above={sig.ema200Above} />
                        : <span className="scr-muted">—</span>}
                    </td>
                    <td className="scr-td">
                      {sig ? <SwingStructureLabel structure={sig.swingStructure} /> : <span className="scr-muted">—</span>}
                    </td>
                    <td className="scr-td scr-td--sparkline">
                      <Sparkline prices={sig?.sparkline ?? []} />
                    </td>
                    <td className="scr-td scr-td--num" onClick={(e) => e.stopPropagation()}>
                      <div className="tt-actions">
                        <button className="tt-btn tt-btn--notes" data-tooltip="Chi tiết" aria-label={`Xem chi tiết ${coin.symbol}`} onClick={() => setSelectedCoin(coin)}>
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

        {/* ── pagination ── */}
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
