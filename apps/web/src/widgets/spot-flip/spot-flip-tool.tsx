'use client';

import { useEffect, useMemo, useState } from 'react';
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

/** Known quote assets, so we can peel the base off a full pair for display. */
const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'BTC', 'ETH'];

/** Full names for the coins we commonly show; falls back to the pair. */
const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  BNB: 'BNB',
  XRP: 'XRP',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  MATIC: 'Polygon',
  DOT: 'Polkadot',
  PEPE: 'Pepe',
  SHIB: 'Shiba Inu',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  SUI: 'Sui',
  VIRTUAL: 'Virtuals Protocol',
  WIF: 'dogwifhat',
  ORDI: 'ORDI',
  TIA: 'Celestia',
};

/** Deterministic avatar background so a coin always gets the same color. */
const AVATAR_COLORS = ['#00C896', '#F6465D', '#5B8DEF', '#F7931A', '#8B5CF6', '#EAB308', '#EC4899', '#14B8A6'];

/* ── helpers ────────────────────────────────────────────────── */

function baseAsset(symbol: string): string {
  const quote = QUOTE_ASSETS.find((q) => symbol.endsWith(q) && symbol.length > q.length);
  return quote ? symbol.slice(0, -quote.length) : symbol;
}

function quoteAsset(symbol: string): string {
  const quote = QUOTE_ASSETS.find((q) => symbol.endsWith(q) && symbol.length > q.length);
  return quote ?? 'USDT';
}

function coinFullName(symbol: string): string {
  const base = baseAsset(symbol);
  return COIN_NAMES[base] ?? `${base} / ${quoteAsset(symbol)}`;
}

function avatarColor(symbol: string): string {
  const base = baseAsset(symbol);
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

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

/** Short Vietnamese take on where the coin sits — the optional card summary. */
function cardSummary(d: SpotFlipAnalysis): string {
  const dipInAtr = d.atrPct > 0 ? d.pullbackPct / d.atrPct : null;
  const dipStr = dipInAtr != null ? ` (~${dipInAtr.toFixed(1)}× biên ngày)` : '';
  const stance =
    dipInAtr != null && dipInAtr >= 1
      ? 'Đã chỉnh sâu so với đỉnh — canh mua nhịp hồi, TP trong 1× biên ngày.'
      : 'Chưa chỉnh sâu — chờ giá về vùng chiết khấu trước khi vào.';
  return `Cách đỉnh 30N −${d.pullbackPct.toFixed(1)}%${dipStr}, biên ngày TB ${d.atrPct.toFixed(1)}%. ${stance}`;
}

/* ── dual up/down bar ───────────────────────────────────────── */

function DualBar({ data }: { data: SpotFlipAnalysis }) {
  // Where price sits in its 30-day range: how far it has risen off the low
  // (green "tăng giá") vs how far it has fallen from the high (red "giảm giá").
  const up = Math.max(0, data.reboundPct);
  const down = Math.max(0, data.pullbackPct);
  const total = up + down;
  const greenShare = total > 0 ? (up / total) * 100 : 50;
  const redShare = 100 - greenShare;

  return (
    <div className="sf-dual">
      <div className="sf-dual-labels">
        <span className="sf-dual-up">{Math.round(greenShare)}% tăng giá</span>
        <span className="sf-dual-down">{Math.round(redShare)}% giảm giá</span>
      </div>
      <div className="sf-dual-bar">
        <span className="sf-dual-seg-up" style={{ flexBasis: `${greenShare}%` }} />
        <span className="sf-dual-seg-down" style={{ flexBasis: `${redShare}%` }} />
      </div>
    </div>
  );
}

/* ── flip calculator (per expanded card) ────────────────────── */

type CalcInputs = { entry: string; tp: string; sl: string; capital: string };

function seedCalc(d: SpotFlipAnalysis): CalcInputs {
  const atr = d.atrPct / 100;
  return {
    entry: String(d.price),
    tp: String(d.price * (1 + TP_ATR_MULT * atr)),
    sl: String(d.price * (1 - SL_ATR_MULT * atr)),
    capital: '1000',
  };
}

function CardDetail({ data }: { data: SpotFlipAnalysis }) {
  const [inputs, setInputs] = useState<CalcInputs>(() => seedCalc(data));

  const dipInAtr = data.atrPct > 0 ? data.pullbackPct / data.atrPct : null;

  const calc = useMemo(() => {
    const e = parseFloat(inputs.entry);
    const t = parseFloat(inputs.tp);
    const s = parseFloat(inputs.sl);
    const cap = parseFloat(inputs.capital);
    if (!Number.isFinite(e) || e <= 0) return null;

    const breakeven = e * (1 + FEE_ROUND_TRIP / 100);
    const tpNetPct = Number.isFinite(t) ? ((t - e) / e) * 100 - FEE_ROUND_TRIP : null;
    const slNetPct = Number.isFinite(s) ? ((s - e) / e) * 100 - FEE_ROUND_TRIP : null;
    const rr = Number.isFinite(t) && Number.isFinite(s) && e > s ? (t - e) / (e - s) : null;
    const profit = tpNetPct != null && Number.isFinite(cap) ? (cap * tpNetPct) / 100 : null;
    const lossAmt = slNetPct != null && Number.isFinite(cap) ? (cap * slNetPct) / 100 : null;

    return { breakeven, tpNetPct, slNetPct, rr, profit, lossAmt };
  }, [inputs]);

  const set = (key: keyof CalcInputs) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInputs((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="sf-detail">
      {/* range / dip / atr */}
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

      {/* flip calculator */}
      <h3 className="sf-card-title">Máy tính chốt lời (net phí 0.10%)</h3>
      <div className="sf-calc-inputs">
        <label className="sf-field">
          <span>Giá vào</span>
          <input value={inputs.entry} onChange={set('entry')} inputMode="decimal" />
        </label>
        <label className="sf-field">
          <span>Chốt lời (TP)</span>
          <input value={inputs.tp} onChange={set('tp')} inputMode="decimal" />
        </label>
        <label className="sf-field">
          <span>Cắt lỗ (SL)</span>
          <input value={inputs.sl} onChange={set('sl')} inputMode="decimal" />
        </label>
        <label className="sf-field">
          <span>Vốn ($)</span>
          <input value={inputs.capital} onChange={set('capital')} inputMode="decimal" />
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
            {calc.lossAmt != null && <span className="sf-result-sub">${calc.lossAmt.toFixed(2)}</span>}
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
    </div>
  );
}

/* ── coin card ──────────────────────────────────────────────── */

function CoinCard({
  data,
  expanded,
  onToggle,
}: {
  data: SpotFlipAnalysis;
  expanded: boolean;
  onToggle: () => void;
}) {
  const base = baseAsset(data.symbol);
  const change = data.changes.h24;

  return (
    <article className="sf-coin-card">
      <button type="button" className="sf-coin-head" onClick={onToggle}>
        <div className="sf-coin-id">
          <span className="sf-avatar" style={{ background: avatarColor(data.symbol) }}>
            {base.slice(0, 2)}
          </span>
          <span className="sf-coin-names">
            <span className="sf-coin-symbol">{base}</span>
            <span className="sf-coin-full">{coinFullName(data.symbol)}</span>
          </span>
        </div>
        <div className="sf-coin-price">
          <span className="sf-coin-price-value">${fmtPrice(data.price)}</span>
          <span className={`sf-coin-change ${pctClass(change)}`}>
            {change != null && Number.isFinite(change) ? (change >= 0 ? '▲' : '▼') : ''} {fmtPct(change, false)}
          </span>
        </div>
      </button>

      <DualBar data={data} />

      <p className="sf-coin-summary">{cardSummary(data)}</p>

      {expanded && <CardDetail data={data} />}
    </article>
  );
}

/* ── component ──────────────────────────────────────────────── */

export function SpotFlipTool() {
  const [symbolInput, setSymbolInput] = useState('');
  const [cards, setCards] = useState<SpotFlipAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function analyze(sym: string) {
    const symbol = sym.trim();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.analyzeSpotFlip(symbol);
      setCards((prev) => [result, ...prev.filter((c) => c.symbol !== result.symbol)]);
      setSymbolInput('');
    } catch {
      setError('Không tải được dữ liệu. Kiểm tra lại mã coin (VD: BTC, SOL, PEPE).');
    } finally {
      setLoading(false);
    }
  }

  // Preload the quick symbols as the initial card list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(QUICK_SYMBOLS.map((s) => apiClient.analyzeSpotFlip(s)));
      if (cancelled) return;
      const ok = results
        .filter((r): r is PromiseFulfilledResult<SpotFlipAnalysis> => r.status === 'fulfilled')
        .map((r) => r.value);
      setCards(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="sf-page">
      <header className="sf-header">
        <h1 className="sf-title">Spot Flip</h1>
        <p className="sf-subtitle">
          Biến động &amp; vị trí trong biên 30 ngày cho lướt spot. Chạm vào coin để xem chi tiết nhịp chỉnh, biên
          ngày (ATR) &amp; máy tính TP/SL net phí (0.05%/chiều).
        </p>
      </header>

      {/* ── search ── */}
      <div className="sf-search">
        <input
          className="sf-search-input"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') analyze(symbolInput);
          }}
          placeholder="Thêm coin, VD: BTC, SOL, PEPE…"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="sf-search-btn" onClick={() => analyze(symbolInput)} disabled={loading}>
          {loading ? 'Đang tải…' : 'Thêm'}
        </button>
      </div>
      <div className="sf-chips">
        {QUICK_SYMBOLS.map((s) => (
          <button key={s} className="sf-chip" onClick={() => analyze(s)}>
            {s}
          </button>
        ))}
      </div>

      {error && <p className="sf-error">{error}</p>}

      {/* ── card list ── */}
      <div className="sf-list">
        {cards.map((c) => (
          <CoinCard
            key={c.symbol}
            data={c}
            expanded={expanded === c.symbol}
            onToggle={() => setExpanded((prev) => (prev === c.symbol ? null : c.symbol))}
          />
        ))}
      </div>
    </div>
  );
}
