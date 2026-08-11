'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { resolveApiBaseUrl, createApiClient } from '@web/shared/api/client';
import type { TrackingCoinRow, TrackingCoinScore, TrackingPriceChange, PaTrend } from '@web/shared/api/types';
import { SetupChartDialog, SWING_CHART_TIMEFRAMES } from '@web/widgets/bitget/setup-chart-dialog';

type Props = { initialCoins: TrackingCoinRow[] };

/** Columns the table can order by. `null` sort = the watchlist's own order (the default). */
type SortCol = 'coin' | 'score' | 'price' | 'chg24h' | 'chg7d' | 'chg30d' | 'chg90d';
type Sort = { col: SortCol; dir: 'desc' | 'asc' };

const PAGE_SIZE = 50;
const PRICE_REFRESH_MS = 5000;
/** 7d / 30d / 90d only move on a daily close — poll them rarely. */
const CHANGE_REFRESH_MS = 5 * 60_000;
/** Scores read closed daily candles, so they move once a day. Same slow cadence. */
const SCORE_REFRESH_MS = 5 * 60_000;

/** Human label per rule id — the Scores tooltip explains where the point came from. */
const RULE_LABELS: Record<string, string> = {
  supertrendD1: 'Supertrend(10,3) D1 bullish',
};

/* ── live price hook ────────────────────────────────────────────── */

type PriceMap = Map<string, number>;
type PriceFlash = Map<string, 'up' | 'down'>;
/** Rolling 24h change as a ratio (0.0123 = +1.23%), keyed by bare symbol. */
type ChangeMap = Map<string, number>;

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1)    return price.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

/**
 * Live price + rolling 24h change from Binance's 24hr ticker. One request serves
 * both columns, and the 24h reading is the exchange's own rolling window — the
 * same thing the Bitget Setup tab shows — not "change since yesterday's close".
 */
function useLivePrices(symbols: string[]) {
  const [prices, setPrices] = useState<PriceMap>(new Map());
  const [changes24h, setChanges24h] = useState<ChangeMap>(new Map());
  const [flash, setFlash]   = useState<PriceFlash>(new Map());
  const prevRef = useRef<PriceMap>(new Map());

  const fetchPrices = useCallback(async () => {
    if (symbols.length === 0) return;
    const usdtSymbols = symbols.map(s => `${s}USDT`);
    const query = encodeURIComponent(JSON.stringify(usdtSymbols));
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${query}`);
      if (!res.ok) return;
      const data = await res.json() as { symbol: string; lastPrice: string; priceChangePercent: string }[];
      const next: PriceMap = new Map();
      const nextChanges: ChangeMap = new Map();
      const nextFlash: PriceFlash = new Map();
      for (const { symbol, lastPrice, priceChangePercent } of data) {
        const coin = symbol.replace(/USDT$/, '');
        const val = parseFloat(lastPrice);
        next.set(coin, val);
        const pct = parseFloat(priceChangePercent);
        if (Number.isFinite(pct)) nextChanges.set(coin, pct / 100);
        const prev = prevRef.current.get(coin);
        if (prev !== undefined && prev !== val) {
          nextFlash.set(coin, val > prev ? 'up' : 'down');
        }
      }
      prevRef.current = next;
      setPrices(next);
      setChanges24h(nextChanges);
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

  return { prices, changes24h, flash };
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

/* ── change columns (24h / 7d / 90d) ────────────────────────────── */

/** Change ratio (0.0123) → signed percent string, same format as the Bitget Setup tab. */
function fmtChange(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Up/down colour class for a change ratio (empty when missing / flat). */
function chgClass(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '';
  return ratio > 0 ? 'bg-chg--up' : ratio < 0 ? 'bg-chg--down' : '';
}

/* ── Scores cell ────────────────────────────────────────────────── */

/**
 * `passed/total` over the scoring rules — `1/1` when the coin's D1 Supertrend is
 * bullish. Full marks read green, anything less reads muted, and hovering lists
 * each rule so the number is never a mystery.
 */
function ScoreCell({ score }: { score: TrackingCoinScore | undefined }) {
  if (!score || score.score === null) return <span className="scr-muted">—</span>;

  const full = score.score === score.maxScore;
  const title = Object.entries(score.rules)
    .map(([id, passed]) => {
      const mark = passed === null ? '–' : passed ? '✓' : '✕';
      return `${mark} ${RULE_LABELS[id] ?? id}`;
    })
    .join('\n');

  return (
    <span className={`tc-score${full ? ' tc-score--full' : ''}`} title={title}>
      {score.score}/{score.maxScore}
    </span>
  );
}

/**
 * A sortable column header — cycles desc → asc → off. "Off" returns the table to
 * the watchlist's own order, which is where it starts: no column sorts by default.
 */
function SortHeader({ label, col, sort, onSort, title }: {
  label: string;
  col: SortCol;
  sort: Sort | null;
  onSort: (col: SortCol) => void;
  title: string;
}) {
  const dir = sort?.col === col ? sort.dir : null;
  return (
    <th
      className="scr-th scr-th--num bg-th-sort"
      aria-sort={dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : 'none'}
    >
      <button type="button" className="bg-th-sort-btn" onClick={() => onSort(col)} title={title}>
        {label}
        <span className="bg-th-sort-ind">{dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '↕'}</span>
      </button>
    </th>
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
  const { prices, changes24h, flash } = useLivePrices(symbols);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  // No column sorts on load — rows keep the watchlist order until a header is clicked.
  const [sort, setSort] = useState<Sort | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [confirmRemoveSymbol, setConfirmRemoveSymbol] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<TrackingCoinRow | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  // 7d / 30d / 90d change per bare symbol, from the API (Binance daily closes).
  const [changes, setChanges] = useState<Record<string, Omit<TrackingPriceChange, 'symbol'>>>({});
  // Rule score per bare symbol — the "Scores" column.
  const [scores, setScores] = useState<Record<string, TrackingCoinScore>>({});

  useEffect(() => { setPage(1); }, [nameFilter, sort]);

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await createApiClient().fetchTrackingPriceChanges(symbols);
        if (cancelled) return;
        setChanges((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            next[r.symbol] = { change7d: r.change7d, change30d: r.change30d, change90d: r.change90d };
          }
          return next;
        });
      } catch { /* non-fatal: the change columns keep their last-known values */ }
    };
    void load();
    const id = setInterval(() => void load(), CHANGE_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbols]);

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await createApiClient().fetchTrackingScores(symbols);
        if (cancelled) return;
        setScores((prev) => {
          const next = { ...prev };
          for (const r of rows) next[r.symbol] = r;
          return next;
        });
      } catch { /* non-fatal: the Scores column keeps its last-known values */ }
    };
    void load();
    const id = setInterval(() => void load(), SCORE_REFRESH_MS);
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

  /**
   * Cycle a column's sort: desc → asc → off. "Off" drops back to the watchlist
   * order rather than another column, and clicking a different header starts
   * fresh at desc, so only one column ever sorts at a time.
   */
  const cycleSort = useCallback((col: SortCol) => {
    // Names read best A→Z first, changes best-performer first.
    const first: 'asc' | 'desc' = col === 'coin' ? 'asc' : 'desc';
    const second: 'asc' | 'desc' = first === 'asc' ? 'desc' : 'asc';
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: first };
      return prev.dir === first ? { col, dir: second } : null;
    });
  }, []);

  /** Numeric sort value for a price/change column — null sinks the row to the bottom. */
  const numericValue = useCallback(
    (symbol: string, col: SortCol): number | null => {
      const v =
        col === 'score'  ? scores[symbol]?.score :
        col === 'price'  ? prices.get(symbol) :
        col === 'chg24h' ? changes24h.get(symbol) :
        col === 'chg7d'  ? changes[symbol]?.change7d :
        col === 'chg30d' ? changes[symbol]?.change30d :
                           changes[symbol]?.change90d;
      return v == null || !Number.isFinite(v) ? null : v;
    },
    [scores, prices, changes24h, changes],
  );

  // Name/symbol search is the only filter left (2026-07-26 — the zone / quality /
  // trend / holding chips were dropped with the signal refactor).
  const sorted = useMemo(() => {
    const q = nameFilter.trim().toUpperCase();
    const filtered = coins.filter((c) => !q || c.symbol.includes(q) || c.name.toUpperCase().includes(q));
    if (!sort) return filtered;
    if (sort.col === 'coin') {
      return [...filtered].sort((a, b) =>
        sort.dir === 'asc' ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol));
    }
    const miss = sort.dir === 'desc' ? -Infinity : Infinity;
    return [...filtered].sort((a, b) => {
      const va = numericValue(a.symbol, sort.col) ?? miss;
      const vb = numericValue(b.symbol, sort.col) ?? miss;
      return sort.dir === 'desc' ? vb - va : va - vb;
    });
  }, [coins, nameFilter, sort, numericValue]);

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
                <th className="scr-th scr-th--coin bg-th-sort" aria-sort={sort?.col === 'coin' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="bg-th-sort-btn" onClick={() => cycleSort('coin')} title="Sắp xếp theo tên coin">
                    Coin
                    <span className="bg-th-sort-ind">
                      {sort?.col === 'coin' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
                <SortHeader label="Scores" col="score" sort={sort} onSort={cycleSort} title="Số tiêu chí coin đang thoả / tổng số tiêu chí. Hiện chỉ có 1: Supertrend(10,3) D1 bullish (nến D1 đã đóng)." />
                <SortHeader label="Giá"   col="price"  sort={sort} onSort={cycleSort} title="Giá hiện tại (Binance, cập nhật mỗi 5 giây)" />
                <SortHeader label="24h %" col="chg24h" sort={sort} onSort={cycleSort} title="Thay đổi 24 giờ (rolling, ticker Binance)" />
                <SortHeader label="7d %"  col="chg7d"  sort={sort} onSort={cycleSort} title="Thay đổi 7 ngày (so với close 7 nến D1 trước)" />
                <SortHeader label="30d %" col="chg30d" sort={sort} onSort={cycleSort} title="Thay đổi 30 ngày (so với close 30 nến D1 trước)" />
                <SortHeader label="90d %" col="chg90d" sort={sort} onSort={cycleSort} title="Thay đổi 90 ngày (so với close 90 nến D1 trước)" />
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
                const price = prices.get(coin.symbol);
                const chg24h = changes24h.get(coin.symbol) ?? null;
                const chg = changes[coin.symbol];
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
                    </td>
                    <td className="scr-td scr-td--num tc-td--score">
                      <ScoreCell score={scores[coin.symbol]} />
                    </td>
                    {/* Live price — its own column since 2026-08-11 (was stacked under the ticker). */}
                    <td className="scr-td scr-td--num tc-td--price">
                      {price != null
                        ? <span className={`tc-live-price tc-live-price--${flash.get(coin.symbol) ?? 'idle'}`}>
                            ${formatPrice(price)}
                          </span>
                        : <span className="scr-muted">—</span>}
                    </td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg24h)}`}>{fmtChange(chg24h)}</td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg?.change7d)}`}>{fmtChange(chg?.change7d)}</td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg?.change30d)}`}>{fmtChange(chg?.change30d)}</td>
                    <td className={`scr-td scr-td--num tc-td--chg ${chgClass(chg?.change90d)}`}>{fmtChange(chg?.change90d)}</td>
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
