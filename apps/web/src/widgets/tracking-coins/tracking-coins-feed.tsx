'use client';

import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { resolveApiBaseUrl, createApiClient } from '@web/shared/api/client';
import type { TrackingCoinRow, PaTrend, CoinSetup, DcaPosition } from '@web/shared/api/types';
import { TrackingCoinChatDrawer } from '@web/widgets/tracking-coin-chat-drawer/tracking-coin-chat-drawer';
import { CoinJournalPanel } from '@web/widgets/tracking-coin-journal/tracking-coin-journal';

type Props = { initialCoins: TrackingCoinRow[] };
type SortKey = 'dca' | 'ext' | 'mktcap' | 'rsi' | 'vol' | 'coin';

const PAGE_SIZE = 50;
const PRICE_REFRESH_MS = 5000;

/* ── live price hook ────────────────────────────────────────────── */

type PriceMap = Map<string, number>;
type PriceFlash = Map<string, 'up' | 'down'>;

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1)    return price.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

function useLivePrices(symbols: string[]) {
  const [prices, setPrices] = useState<PriceMap>(new Map());
  const [flash, setFlash]   = useState<PriceFlash>(new Map());
  const prevRef = useRef<PriceMap>(new Map());

  const fetchPrices = useCallback(async () => {
    if (symbols.length === 0) return;
    const usdtSymbols = symbols.map(s => `${s}USDT`);
    const query = encodeURIComponent(JSON.stringify(usdtSymbols));
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${query}`);
      if (!res.ok) return;
      const data = await res.json() as { symbol: string; price: string }[];
      const next: PriceMap = new Map();
      const nextFlash: PriceFlash = new Map();
      for (const { symbol, price } of data) {
        const coin = symbol.replace(/USDT$/, '');
        const val = parseFloat(price);
        next.set(coin, val);
        const prev = prevRef.current.get(coin);
        if (prev !== undefined && prev !== val) {
          nextFlash.set(coin, val > prev ? 'up' : 'down');
        }
      }
      prevRef.current = next;
      setPrices(next);
      setFlash(nextFlash);
      // clear flash after 600ms
      if (nextFlash.size > 0) {
        setTimeout(() => setFlash(new Map()), 600);
      }
    } catch { /* ignore */ }
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchPrices]);

  return { prices, flash };
}

/* ── market cap formatter ───────────────────────────────────────── */

function fmtMarketCap(cap: number | null): string | null {
  if (cap == null) return null;
  if (cap >= 1_000_000_000) return `$${(cap / 1_000_000_000).toFixed(1)}B`;
  if (cap >= 1_000_000) return `$${(cap / 1_000_000).toFixed(1)}M`;
  return `$${cap.toLocaleString()}`;
}

/* ── shared: W/D1/H4 stacked layout ─────────────────────────────── */

function TfStack({ w, d1, h4 }: { w: ReactNode; d1: ReactNode; h4: ReactNode }) {
  return (
    <div className="tc-tf-stack">
      <div className="tc-tf-stack-row">
        <span className="tc-tf-label">W</span>
        <span className="tc-tf-stack-val">{w}</span>
      </div>
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

/* ── DCA cell — "đáng DCA" quality score + action zone ──────────── */

function dcaQuality(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: 'An toàn', cls: 'tc-dca--safe' };
  if (score >= 50) return { label: 'Khá', cls: 'tc-dca--ok' };
  if (score >= 30) return { label: 'Rủi ro', cls: 'tc-dca--risky' };
  return { label: 'Tránh', cls: 'tc-dca--avoid' };
}

const ZONE_META: Record<'GOM' | 'CHO' | 'CHOT', { label: string; cls: string; title: string }> = {
  GOM:  { label: 'GOM',  cls: 'tc-zone--gom',  title: 'Quá bán + gần đáy 20 ngày → vùng gom thêm (add layer)' },
  CHOT: { label: 'CHỐT', cls: 'tc-zone--chot', title: 'Giá đã reclaim EMA34 → chốt nếu đang ôm' },
  CHO:  { label: 'Chờ',  cls: 'tc-zone--cho',  title: 'Dưới EMA34 nhưng chưa đủ sâu để gom' },
};

function DcaCell({ score, zone }: { score: number | null | undefined; zone: 'GOM' | 'CHO' | 'CHOT' | null | undefined }) {
  if (score == null) return <span className="scr-muted">—</span>;
  const q = dcaQuality(score);
  const z = zone ? ZONE_META[zone] : null;
  return (
    <span className="tc-dca" title={`Đáng DCA ${score}/100 (market-cap + trend tuần). ${q.label}.`}>
      <span className={`tc-dca-badge ${q.cls}`}>
        <span className="tc-dca-score">{score}</span>
        <span className="tc-dca-tag">{q.label}</span>
      </span>
      {z && <span className={`tc-zone ${z.cls}`} title={z.title}>{z.label}</span>}
    </span>
  );
}

/* ── extension % cell (distance above EMA34 — exit/overheat gauge) ── */

function ExtCell({ ext }: { ext: number | null }) {
  if (ext == null) return <span className="scr-muted">—</span>;
  const cls =
    ext >= 20 ? 'scr-ext scr-ext--hot' :
    ext >= 0 ? 'scr-ext scr-ext--up' :
    'scr-ext scr-ext--down';
  const sign = ext > 0 ? '+' : '';
  return <span className={cls}>{`${sign}${ext.toFixed(1)}%`}</span>;
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

/* ── icons ──────────────────────────────────────────────────────── */

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function IconSetup() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconPrompt() {
  // Clipboard with text lines — represents "generate & copy analysis prompt".
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="4" rx="1" ry="1" />
      <path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}

/* ── detail modal ───────────────────────────────────────────────── */

type DetailTab = 'overview' | 'journal';

const DETAIL_TABS: ReadonlyArray<[DetailTab, string]> = [
  ['overview', 'Overview'],
  ['journal', 'Journal'],
];

function CoinDetailModal({ coin, onClose }: { coin: TrackingCoinRow; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>('overview');

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

        <div className="tc-detail-tabs" role="tablist">
          {DETAIL_TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`tc-detail-tab${tab === key ? ' tc-detail-tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="dialog-body tc-detail-body">
          {tab === 'overview' && <CoinOverview coin={coin} />}
          {tab === 'journal' && <CoinJournalPanel symbol={coin.symbol} />}
        </div>
      </div>
    </div>
  );
}

function CoinOverview({ coin }: { coin: TrackingCoinRow }) {
  const sig = coin.signal;
  const tvUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}USDT`;

  if (!sig) {
    return (
      <div className="tc-overview">
        <p className="scr-muted tc-overview__empty">Chưa có dữ liệu. Nhấn ⚡ Re-analyze để quét coin này.</p>
        <a className="tc-detail-tv-btn" href={tvUrl} target="_blank" rel="noopener noreferrer">Mở TradingView ↗</a>
      </div>
    );
  }

  const rows = [
    { tf: 'W',  trend: sig.weekTrend, utBot: sig.utBotW1Bullish, e34: sig.wEma34Above,  e89: sig.wEma89Above,  e200: sig.wEma200Above,  rsi: sig.wRsi,  vol: sig.wVolMultiplier },
    { tf: 'D1', trend: sig.trend,   utBot: sig.utBotD1Bullish, e34: sig.ema34Above,   e89: sig.ema89Above,   e200: sig.ema200Above,  rsi: sig.rsi,   vol: sig.volMultiplier },
    { tf: 'H4', trend: sig.h4Trend, utBot: sig.utBotH4Bullish, e34: sig.h4Ema34Above, e89: sig.h4Ema89Above, e200: sig.h4Ema200Above, rsi: sig.h4Rsi, vol: sig.h4VolMultiplier },
  ];

  return (
    <div className="tc-overview">
      <section className="tc-detail-section">
        <div className="tc-detail-label">Chỉ báo theo khung</div>
        <div className="tc-tf-grid">
          <div className="tc-tf-grid__head">
            <span>TF</span><span>Trend</span><span>UT Bot</span><span>EMA</span><span>RSI</span><span>Vol×</span>
          </div>
          {rows.map((r) => (
            <div key={r.tf} className="tc-tf-grid__row">
              <span className="tc-tf-grid__tf">{r.tf}</span>
              <TrendBadge trend={r.trend} />
              <UtBotBadge bullish={r.utBot} />
              <EmaPips e34={r.e34} e89={r.e89} e200={r.e200} />
              <RsiCell rsi={r.rsi} />
              <VolCell vol={r.vol} />
            </div>
          ))}
        </div>
      </section>

      <div className="tc-detail-footer">
        Cập nhật: {new Date(sig.scannedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
      </div>
      <a className="tc-detail-tv-btn" href={tvUrl} target="_blank" rel="noopener noreferrer">Mở TradingView ↗</a>
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

/* ── setup settings dialog ──────────────────────────────────────── */

function CoinSetupDialog({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [form, setForm] = useState<CoinSetup>({ swingMaxLoss: null, swingMinRR: null, daytradeMaxLoss: null, daytradeMinRR: null, dcaMaxLayers: null });
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    createApiClient().fetchCoinSetup(symbol)
      .then((r) => { if (!cancelled) { setForm(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  function field(key: keyof CoinSetup) {
    const v = form[key];
    return v == null ? '' : String(v);
  }
  function setField(key: keyof CoinSetup, val: string) {
    setForm((f) => ({ ...f, [key]: val === '' ? null : parseFloat(val) }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      await createApiClient().updateCoinSetup(symbol, form);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi lưu.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog setup-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Risk setup — {symbol}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body setup-body">
          {loading ? (
            <div className="ord-loading"><span className="ord-loading__spinner" /><span>Đang tải…</span></div>
          ) : (
            <>
              <p className="setup-hint">
                Khi Re-analyze hoặc scan tự động chạy, hệ thống dùng các thông số này để tính volume (số lượng) cho lệnh limit của ngày đó.
              </p>
              <div className="setup-section">
                <div className="setup-section__title">Swing (2–5 ngày)</div>
                <div className="setup-fields">
                  <label className="setup-label">
                    <span>SL tối đa ($)</span>
                    <input className="setup-input" type="number" min="0" step="1" placeholder="e.g. 10"
                      value={field('swingMaxLoss')} onChange={(e) => setField('swingMaxLoss', e.target.value)} />
                  </label>
                  <label className="setup-label">
                    <span>R:R tối thiểu</span>
                    <input className="setup-input" type="number" min="0" step="0.1" placeholder="e.g. 1.5"
                      value={field('swingMinRR')} onChange={(e) => setField('swingMinRR', e.target.value)} />
                  </label>
                </div>
              </div>
              <div className="setup-section">
                <div className="setup-section__title">DCA</div>
                <div className="setup-fields">
                  <label className="setup-label">
                    <span>Trần số layer</span>
                    <input className="setup-input" type="number" min="1" step="1" placeholder="mặc định 5"
                      value={field('dcaMaxLayers')} onChange={(e) => setField('dcaMaxLayers', e.target.value)} />
                  </label>
                </div>
              </div>
              {error && <p className="scr-muted ord-error">{error}</p>}
              <div className="setup-actions">
                {saved && <span className="setup-saved">✓ Đã lưu</span>}
                <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Đang lưu…' : 'Lưu setup'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── DCA position dialog — buy log, average, P&L, profit-aware chốt ─ */

const DCA_MAX_LAYERS = 5;

function fmtNum(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(8);
}

/** Plain decimal string for a <input type="number"> value (no grouping/scientific). */
function priceInputStr(n: number): string {
  if (!(n > 0)) return '';
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 8 });
}

function DcaPositionDialog({ symbol, livePrice, onClose, onChanged }: {
  symbol: string;
  livePrice: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pos, setPos] = useState<DcaPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState('');
  const [usd, setUsd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefilledRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    createApiClient().fetchDcaPosition(symbol)
      .then((r) => { setPos(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  const cur = livePrice ?? pos?.currentPrice ?? 0;

  // Default the "Giá mua" field to the current price as soon as one is known (once per open).
  useEffect(() => {
    if (prefilledRef.current) return;
    if (cur > 0) { setPrice(priceInputStr(cur)); prefilledRef.current = true; }
  }, [cur]);
  const avg = pos?.avgEntry ?? null;
  const maxLayers = pos?.maxLayers ?? DCA_MAX_LAYERS;
  const atCap = (pos?.layers ?? 0) >= maxLayers;
  const livePnlPct = avg && avg > 0 && cur > 0 ? ((cur - avg) / avg) * 100 : null;
  const inProfit = livePnlPct != null && livePnlPct >= 0;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const p = parseFloat(price), u = parseFloat(usd);
    if (!(p > 0) || !(u > 0)) { setError('Nhập giá và số USD hợp lệ.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await createApiClient().addDcaBuy(symbol, { price: p, usd: u });
      setPos(r); setPrice(cur > 0 ? priceInputStr(cur) : ''); setUsd(''); onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu.');
    } finally { setBusy(false); }
  }

  async function handleDelete(buyId: string) {
    setBusy(true);
    try { const r = await createApiClient().deleteDcaBuy(symbol, buyId); setPos(r); onChanged(); }
    catch { /* ignore */ } finally { setBusy(false); }
  }

  async function handleClose() {
    if (!confirm(`Đóng (xóa) toàn bộ vị thế DCA của ${symbol}?`)) return;
    setBusy(true);
    try { const r = await createApiClient().closeDcaPosition(symbol); setPos(r); onChanged(); }
    catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog setup-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">DCA position — {symbol}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body setup-body">
          {loading ? (
            <div className="ord-loading"><span className="ord-loading__spinner" /><span>Đang tải…</span></div>
          ) : (
            <>
              {/* summary */}
              <div className="dcapos-summary">
                <div className="dcapos-stat"><span>Layer</span><strong>{pos?.layers ?? 0} / {maxLayers}</strong></div>
                <div className="dcapos-stat"><span>Giá TB</span><strong>{avg ? `$${fmtNum(avg)}` : '—'}</strong></div>
                <div className="dcapos-stat"><span>Vốn đã vào</span><strong>${(pos?.capitalDeployed ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong></div>
                <div className="dcapos-stat">
                  <span>P&L</span>
                  <strong className={livePnlPct == null ? '' : inProfit ? 'dcapos-pos' : 'dcapos-neg'}>
                    {livePnlPct == null ? '—' : `${livePnlPct >= 0 ? '+' : ''}${livePnlPct.toFixed(2)}%`}
                  </strong>
                </div>
              </div>

              {avg != null && (
                <p className={`dcapos-hint ${inProfit ? 'dcapos-hint--ok' : 'dcapos-hint--warn'}`}>
                  {inProfit
                    ? '✓ Giá hiện > giá TB → khi reclaim EMA34/EMA89 là CHỐT có lãi.'
                    : '⚠ Giá hiện < giá TB → reclaim EMA34 có thể vẫn lỗ. Chốt khi giá ≥ giá TB.'}
                  {pos?.nextAddPrice != null && ` · Gom layer kế ở ~$${fmtNum(pos.nextAddPrice)} (−8%).`}
                </p>
              )}

              {/* add buy */}
              <form className="dcapos-add" onSubmit={handleAdd}>
                <input className="setup-input" type="number" step="any" min="0" placeholder="Giá mua"
                  value={price} onChange={(e) => setPrice(e.target.value)} />
                <input className="setup-input" type="number" step="any" min="0" placeholder="Số USD"
                  value={usd} onChange={(e) => setUsd(e.target.value)} />
                <button className="btn btn--primary" type="submit" disabled={busy || atCap}>
                  + Gom
                </button>
              </form>
              {atCap && <p className="scr-muted" style={{ fontSize: '0.75rem' }}>Đã đạt trần {maxLayers} layer — ngừng gom, chờ hồi.</p>}
              {error && <p className="scr-muted ord-error">{error}</p>}

              {/* buy list */}
              {pos && pos.buys.length > 0 && (
                <table className="dcapos-table">
                  <thead><tr><th>Ngày</th><th>Giá</th><th>USD</th><th></th></tr></thead>
                  <tbody>
                    {pos.buys.map((b) => (
                      <tr key={b.id}>
                        <td>{b.boughtAt.slice(0, 10)}</td>
                        <td>${fmtNum(b.price)}</td>
                        <td>${b.usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                        <td><button className="dcapos-del" onClick={() => handleDelete(b.id)} disabled={busy} aria-label="Xóa">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {pos && pos.buys.length > 0 && (
                <div className="setup-actions">
                  <button className="btn btn--danger" onClick={handleClose} disabled={busy}>Đóng vị thế (đã chốt)</button>
                </div>
              )}
            </>
          )}
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
      onAdded({ ...data, marketCap: null, addedAt: new Date().toISOString(), signal: null, dcaPosition: null });
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
  const symbols = useMemo(() => coins.map(c => c.symbol), [coins]);
  const { prices, flash } = useLivePrices(symbols);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('dca');
  const [showAddForm, setShowAddForm] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [confirmRemoveSymbol, setConfirmRemoveSymbol] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<TrackingCoinRow | null>(null);
  const [chatCoin, setChatCoin] = useState<TrackingCoinRow | null>(null);
  const [setupCoin, setSetupCoin] = useState<string | null>(null);
  const [dcaCoin, setDcaCoin] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [nameFilter, sortKey]);

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
    const filtered = coins.filter((c) =>
      !q || c.symbol.includes(q) || c.name.toUpperCase().includes(q)
    );
    return [...filtered].sort((a, b) => {
      if (sortKey === 'dca') return (b.signal?.dcaScore ?? -Infinity) - (a.signal?.dcaScore ?? -Infinity);
      if (sortKey === 'ext') return (b.signal?.extPct ?? -Infinity) - (a.signal?.extPct ?? -Infinity);
      if (sortKey === 'mktcap') return (b.marketCap ?? -Infinity) - (a.marketCap ?? -Infinity);
      if (sortKey === 'rsi') return (b.signal?.rsi ?? 0) - (a.signal?.rsi ?? 0);
      if (sortKey === 'vol') return (b.signal?.volMultiplier ?? 0) - (a.signal?.volMultiplier ?? 0);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [coins, sortKey, nameFilter]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      {selectedCoin && <CoinDetailModal coin={selectedCoin} onClose={() => setSelectedCoin(null)} />}
      {chatCoin && (
        <TrackingCoinChatDrawer
          coin={chatCoin}
          livePrice={prices.get(chatCoin.symbol) ?? null}
          onClose={() => setChatCoin(null)}
        />
      )}
      {confirmRemoveSymbol && (
        <ConfirmRemoveDialog
          symbol={confirmRemoveSymbol}
          isRemoving={removingSymbol === confirmRemoveSymbol}
          onConfirm={async () => { await handleRemoveCoin(confirmRemoveSymbol); setConfirmRemoveSymbol(null); }}
          onCancel={() => setConfirmRemoveSymbol(null)}
        />
      )}
      {setupCoin && <CoinSetupDialog symbol={setupCoin} onClose={() => setSetupCoin(null)} />}
      {dcaCoin && (
        <DcaPositionDialog
          symbol={dcaCoin}
          livePrice={prices.get(dcaCoin) ?? null}
          onClose={() => setDcaCoin(null)}
          onChanged={reloadCoins}
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
        <div className="scr-filters scr-filters--right">
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
                <th className="scr-th scr-th--num" onClick={() => setSortKey('dca')}>
                  DCA {sortKey === 'dca' && '↓'}
                </th>
                <th className="scr-th tc-th--stacked">Trend (PA)</th>
                <th className="scr-th tc-th--stacked">UT Bot</th>
                <th className="scr-th tc-th--stacked">EMA</th>
                <th className="scr-th scr-th--num" onClick={() => setSortKey('ext')}>
                  Ext% {sortKey === 'ext' && '↓'}
                </th>
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
                  <td colSpan={10} className="scr-empty">
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
                      {coin.marketCap != null && <span className="scr-name">{fmtMarketCap(coin.marketCap)}</span>}
                      {prices.has(coin.symbol) && (
                        <span className={`tc-live-price tc-live-price--${flash.get(coin.symbol) ?? 'idle'}`}>
                          ${formatPrice(prices.get(coin.symbol)!)}
                        </span>
                      )}
                    </td>
                    {/* DCA — đáng DCA (quality) + vùng hành động */}
                    <td className="scr-td scr-td--num">
                      <DcaCell score={sig?.dcaScore} zone={sig?.dcaZone} />
                    </td>
                    {/* Trend W / D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            w={<TrendBadge trend={sig.weekTrend} />}
                            d1={<TrendBadge trend={sig.trend} />}
                            h4={<TrendBadge trend={sig.h4Trend} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    {/* UT Bot W / D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            w={<UtBotBadge bullish={sig.utBotW1Bullish} />}
                            d1={<UtBotBadge bullish={sig.utBotD1Bullish} />}
                            h4={<UtBotBadge bullish={sig.utBotH4Bullish} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    {/* EMA W / D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            w={<EmaPips e34={sig.wEma34Above} e89={sig.wEma89Above} e200={sig.wEma200Above} />}
                            d1={<EmaPips e34={sig.ema34Above} e89={sig.ema89Above} e200={sig.ema200Above} />}
                            h4={<EmaPips e34={sig.h4Ema34Above} e89={sig.h4Ema89Above} e200={sig.h4Ema200Above} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    {/* Ext% — distance above EMA34 (D1) */}
                    <td className="scr-td scr-td--num">
                      <ExtCell ext={sig?.extPct ?? null} />
                    </td>
                    {/* RSI W / D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            w={<RsiCell rsi={sig.wRsi} />}
                            d1={<RsiCell rsi={sig.rsi} />}
                            h4={<RsiCell rsi={sig.h4Rsi} />}
                          />
                        : <span className="scr-muted">—</span>}
                    </td>
                    {/* Vol W / D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            w={<VolCell vol={sig.wVolMultiplier} />}
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
                        <button className="tt-btn tt-btn--ai" data-tooltip="Tạo prompt" aria-label={`Tạo prompt phân tích cho ${coin.symbol}`} onClick={() => setChatCoin(coin)}>
                          <IconPrompt />
                        </button>
                        <button className={`tt-btn tt-btn--dca${coin.dcaPosition ? ' tt-btn--dca-active' : ''}`} data-tooltip={coin.dcaPosition ? `Đang ôm ${coin.dcaPosition.layers}L` : 'DCA position'} aria-label={`DCA position ${coin.symbol}`} onClick={() => setDcaCoin(coin.symbol)}>
                          {coin.dcaPosition ? `${coin.dcaPosition.layers}L` : <IconLayers />}
                        </button>
                        <button className="tt-btn tt-btn--setup" data-tooltip="Setup" aria-label={`Setup ${coin.symbol}`} onClick={() => setSetupCoin(coin.symbol)}>
                          <IconSetup />
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
