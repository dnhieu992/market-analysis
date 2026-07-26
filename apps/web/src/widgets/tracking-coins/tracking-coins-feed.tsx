'use client';

import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { resolveApiBaseUrl, createApiClient } from '@web/shared/api/client';
import type { TrackingCoinRow, PaTrend } from '@web/shared/api/types';
import { SetupChartDialog, SWING_CHART_TIMEFRAMES } from '@web/widgets/bitget/setup-chart-dialog';
import { QqeCell, bareQqeSymbol, type QqeMap } from '@web/widgets/bitget/qqe-cell';

type Props = { initialCoins: TrackingCoinRow[] };
type SortKey = 'mktcap' | 'rsi' | 'vol' | 'coin';

const PAGE_SIZE = 50;
const PRICE_REFRESH_MS = 5000;
// QQE readings only change on candle close — same slow cadence as the Bitget Setup tab.
const QQE_REFRESH_MS = 60_000;
/** Timeframes the QQE column reports on — the page's swing horizon, same order as the chart switcher. */
const QQE_TFS = SWING_CHART_TIMEFRAMES;
const QQE_TF_KEYS = QQE_TFS.map((t) => t.tf);

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

/* ── 30d change ─────────────────────────────────────────────────── */

/** % change between the first and last close of the 30-day series (null when unusable). */
function change30dPct(prices: number[]): number | null {
  if (prices.length < 2) return null;
  const first = prices[0]!;
  const last = prices[prices.length - 1]!;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
}

function Change30d({ prices }: { prices: number[] }) {
  const pct = change30dPct(prices);
  if (pct === null) return <span className="scr-muted">—</span>;
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return (
    <span className={`tc-chg30 tc-chg30--${dir}`} title={`Thay đổi 30 ngày: ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}>
      {pct >= 0 ? '+' : '−'}{Math.abs(pct).toFixed(1)}%
    </span>
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

function IconChart() {
  // Candlestick glyph — opens the same server-rendered chart the /bitget page uses.
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="3" x2="8" y2="21" />
      <rect x="5" y="7" width="6" height="9" rx="1" />
      <line x1="17" y1="3" x2="17" y2="21" />
      <rect x="14" y="10" width="6" height="7" rx="1" />
    </svg>
  );
}

/* ── detail modal ───────────────────────────────────────────────── */

/** Read-only indicator sheet for one coin — no tabs, no position, no portfolio. */
function CoinDetailModal({ coin, onClose }: {
  coin: TrackingCoinRow;
  onClose: () => void;
}) {
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
          <CoinOverview coin={coin} />
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
        <p className="scr-muted tc-overview__empty">Chưa có dữ liệu chỉ báo cho coin này.</p>
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

/* ── Strategy & scoring explainer dialog ─────────────────────────── */

function StrategyInfoDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Chiến lược Gom đáy &amp; cách tính điểm</span>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body si">
          <section className="si-sec">
            <h3 className="si-h">Chiến lược đang chạy — Gom đáy x2 (spot, no SL)</h3>
            <p className="si-p">
              Mua coin đã <b>giảm sâu 50–85%</b> từ đỉnh chu kỳ (đỉnh 2 năm) khi giá đang{' '}
              <b>đi ngang trong nền hẹp</b> (base ≤ 25%), nằm sát đáy nền và RSI(14) D1 ≤ 45.
              Vào lệnh <b>spot, KHÔNG stop-loss</b>, gom theo ladder <b>tối đa 3 lần × −15%</b>,
              rồi <b>bán toàn bộ ở x2</b> (+100% so với giá trung bình) — không chốt sớm ở EMA34.
            </p>
            <p className="si-p si-note">
              Vì không có stop-loss, <b>việc chọn coin chính là lớp phòng thủ thay stop-loss</b>:
              chỉ gom coin đủ lớn và cấu trúc tuần còn sống. Đó là ý nghĩa của cổng{' '}
              <b>dcaScore ≥ 50</b> — backtest cho thấy cổng này nâng PF từ 1.58 → 3.53.
            </p>
          </section>

          <section className="si-sec">
            <h3 className="si-h">Trạng thái (zone)</h3>
            <ul className="si-list">
              <li><b>GOM</b> — đủ điều kiện đáy chất lượng <i>và</i> đã qua cổng dcaScore ≥ 50 → gom / gom thêm.</li>
              <li><b>Chờ</b> — chưa vào vùng đáy chất lượng, hoặc chưa qua cổng dcaScore.</li>
              <li><b>Hồi</b> — giá đã hồi lên trên EMA34 → không còn là điểm gom, theo dõi chốt x2.</li>
            </ul>
          </section>

          <section className="si-sec">
            <h3 className="si-h">Cách tính điểm — dcaScore (0–100)</h3>
            <p className="si-p">
              dcaScore = <b>Vốn hóa (tối đa 50)</b> + <b>Cấu trúc tuần (tối đa 50)</b>.
              Đo mức độ “an toàn để DCA” — coin càng lớn và trend tuần càng khỏe thì càng ít rủi ro về 0.
            </p>

            <div className="si-grid">
              <div className="si-card">
                <div className="si-card-h">Vốn hóa · tối đa 50 điểm</div>
                <table className="si-table">
                  <tbody>
                    <tr><td>≥ $1B</td><td>50</td></tr>
                    <tr><td>≥ $300M</td><td>40</td></tr>
                    <tr><td>≥ $100M</td><td>30</td></tr>
                    <tr><td>≥ $30M</td><td>20</td></tr>
                    <tr><td>≥ $10M</td><td>10</td></tr>
                    <tr><td>&lt; $10M / không rõ</td><td>0</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="si-card">
                <div className="si-card-h">Cấu trúc tuần · tối đa 50 điểm</div>
                <table className="si-table">
                  <tbody>
                    <tr><td>Trend tuần: StrongUp / Up</td><td>20 / 15</td></tr>
                    <tr><td>Trend tuần: Neutral / Down / StrongDown</td><td>8 / 2 / 0</td></tr>
                    <tr><td>Giá trên EMA200 tuần</td><td>+15</td></tr>
                    <tr><td>Giá trên EMA89 tuần</td><td>+8</td></tr>
                    <tr><td>UTBot tuần bullish</td><td>+7</td></tr>
                  </tbody>
                </table>
                <p className="si-fine">(Phần cấu trúc tuần giới hạn tối đa 50 điểm.)</p>
              </div>
            </div>

            <div className="si-buckets">
              <span className="si-bucket si-bucket--safe">≥ 70 · An toàn</span>
              <span className="si-bucket si-bucket--ok">≥ 50 · OK (cổng GOM)</span>
              <span className="si-bucket si-bucket--risky">≥ 30 · Rủi ro</span>
              <span className="si-bucket si-bucket--avoid">&lt; 30 · Tránh</span>
            </div>
          </section>
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
      onAdded({ ...data, marketCap: null, addedAt: new Date().toISOString(), signal: null });
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
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('coin');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [confirmRemoveSymbol, setConfirmRemoveSymbol] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<TrackingCoinRow | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [qqe, setQqe] = useState<QqeMap>({});

  useEffect(() => { setPage(1); }, [nameFilter, sortKey]);

  // QQE Signals (colinmck) per coin — the same endpoint/column the Bitget Setup tab uses,
  // narrowed to this page's swing horizon (H4/D1/W1) so ~40 coins stay one cheap scan.
  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await createApiClient().fetchBitgetQqeSignals(symbols, QQE_TF_KEYS);
        if (cancelled) return;
        setQqe((prev) => {
          const next = { ...prev };
          for (const r of rows) next[bareQqeSymbol(r.symbol)] = r.signals;
          return next;
        });
      } catch { /* non-fatal: the QQE column keeps its last-known badges */ }
    };
    void load();
    const id = setInterval(() => void load(), QQE_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbols]);

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

  // Name/symbol search is the only filter left (2026-07-26 — the zone / quality /
  // trend / holding chips were dropped with the signal refactor).
  const sorted = useMemo(() => {
    const q = nameFilter.trim().toUpperCase();
    const filtered = coins.filter((c) => !q || c.symbol.includes(q) || c.name.toUpperCase().includes(q));
    return [...filtered].sort((a, b) => {
      if (sortKey === 'mktcap') return (b.marketCap ?? -Infinity) - (a.marketCap ?? -Infinity);
      if (sortKey === 'rsi') return (b.signal?.rsi ?? 0) - (a.signal?.rsi ?? 0);
      if (sortKey === 'vol') return (b.signal?.volMultiplier ?? 0) - (a.signal?.volMultiplier ?? 0);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [coins, nameFilter, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      {selectedCoin && (
        <CoinDetailModal
          key={selectedCoin.symbol}
          coin={selectedCoin}
          onClose={() => setSelectedCoin(null)}
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
      {chartSymbol && (
        <SetupChartDialog
          symbol={chartSymbol}
          tf="4h"
          timeframes={SWING_CHART_TIMEFRAMES}
          onClose={() => setChartSymbol(null)}
        />
      )}
      {showInfo && <StrategyInfoDialog onClose={() => setShowInfo(false)} />}

      <main className="dashboard-shell scr-shell">
        {/* header */}
        <div className="tc-page-header">
          <div className="tc-page-title-row">
            <h1 className="scr-title">Tracking Coins</h1>
            <button
              type="button"
              className={`tc-info-btn${showInfo ? ' tc-info-btn--active' : ''}`}
              onClick={() => setShowInfo(true)}
              aria-label="Giải thích chiến lược & cách tính điểm"
              title="Chiến lược & cách tính điểm"
            >
              i
            </button>
          </div>
          <div className="scr-toolbar-right">
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
        <div className="tc-filters">
          <input
            className="scr-search tc-filter-search"
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
                <th className="scr-th" title="Tín hiệu QQE Signals (colinmck) trên nến đã đóng — khung H4/D1/W1, xanh = Long, đỏ = Short">
                  QQE
                </th>
                <th className="scr-th tc-th--stacked">Trend (PA)</th>
                <th className="scr-th tc-th--stacked">UT Bot</th>
                <th className="scr-th tc-th--stacked">EMA</th>
                <th className="scr-th tc-th--stacked" onClick={() => setSortKey('rsi')}>
                  RSI {sortKey === 'rsi' && '↓'}
                </th>
                <th className="scr-th tc-th--stacked" onClick={() => setSortKey('vol')}>
                  Vol× {sortKey === 'vol' && '↓'}
                </th>
                <th className="scr-th scr-th--num" title="Thay đổi giá 30 ngày (close đầu → close cuối của chuỗi 30 nến D1)">
                  30d %
                </th>
                <th className="scr-th scr-th--num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="scr-empty">
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
                      <span className="tc-coin-line">
                        <span className="scr-symbol">{coin.symbol}</span>
                        <button
                          className="tc-chart-btn"
                          aria-label={`Xem chart ${coin.symbol}`}
                          title="Xem chart (SonicR + S/R + RSI)"
                          onClick={(e) => { e.stopPropagation(); setChartSymbol(coin.symbol); }}
                        >
                          <IconChart />
                        </button>
                      </span>
                      {coin.name && <span className="scr-name">{coin.name}</span>}
                      {coin.marketCap != null && <span className="scr-name">{fmtMarketCap(coin.marketCap)}</span>}
                      {prices.has(coin.symbol) && (
                        <span className={`tc-live-price tc-live-price--${flash.get(coin.symbol) ?? 'idle'}`}>
                          ${formatPrice(prices.get(coin.symbol)!)}
                        </span>
                      )}
                    </td>
                    {/* QQE Signals — live flips only (same cell as the Bitget Setup tab) */}
                    <td className="scr-td bg-qqe-cell">
                      <QqeCell signals={qqe[bareQqeSymbol(coin.symbol)]} timeframes={QQE_TFS} />
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
                    <td className="scr-td scr-td--num tc-td--chg30">
                      <Change30d prices={sig?.sparkline ?? []} />
                    </td>
                    <td className="scr-td scr-td--num" onClick={(e) => e.stopPropagation()}>
                      <div className="tt-actions">
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
