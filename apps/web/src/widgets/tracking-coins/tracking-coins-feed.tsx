'use client';

import { useState, useMemo, useEffect, useRef, useCallback, Fragment, type ReactNode } from 'react';
import { resolveApiBaseUrl, createApiClient } from '@web/shared/api/client';
import type { TrackingCoinRow, PaTrend, DcaPosition, Portfolio, SignalHistoryRow } from '@web/shared/api/types';
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

function TfStack({ w, d1, h4, m30 }: { w: ReactNode; d1: ReactNode; h4: ReactNode; m30?: ReactNode }) {
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
      {m30 !== undefined && (
        <div className="tc-tf-stack-row">
          <span className="tc-tf-label">M30</span>
          <span className="tc-tf-stack-val">{m30}</span>
        </div>
      )}
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

/* ── filter facets ──────────────────────────────────────────────── */

type ZoneFilter = 'all' | 'GOM' | 'CHO' | 'CHOT';
type QualityFilter = 'all' | 'safe' | 'ok' | 'risky' | 'avoid';
type TrendGroup = 'up' | 'side' | 'down';
type TrendFilter = 'all' | TrendGroup;

function dcaBucketKey(score: number): Exclude<QualityFilter, 'all'> {
  if (score >= 70) return 'safe';
  if (score >= 50) return 'ok';
  if (score >= 30) return 'risky';
  return 'avoid';
}

function trendGroup(t: PaTrend): TrendGroup {
  if (t === 'StrongUp' || t === 'Up') return 'up';
  if (t === 'Down' || t === 'StrongDown') return 'down';
  return 'side';
}

const ZONE_FILTERS: ReadonlyArray<{ key: ZoneFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'GOM', label: 'GOM' },
  { key: 'CHO', label: 'Chờ' },
  { key: 'CHOT', label: 'Hồi' },
];

const QUALITY_FILTERS: ReadonlyArray<{ key: QualityFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'safe', label: 'An toàn' },
  { key: 'ok', label: 'Khá' },
  { key: 'risky', label: 'Rủi ro' },
  { key: 'avoid', label: 'Tránh' },
];

const TREND_FILTERS: ReadonlyArray<{ key: TrendFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'up', label: '↑ Tăng' },
  { key: 'side', label: '→ Ngang' },
  { key: 'down', label: '↓ Giảm' },
];

const ZONE_META: Record<'GOM' | 'CHO' | 'CHOT', { label: string; cls: string; title: string }> = {
  GOM:  { label: 'GOM',  cls: 'tc-zone--gom',  title: 'Đáy mạnh (giảm 50–85% + nền đi ngang, RSI thấp) đã qua cổng dcaScore≥50 → gom (spot, no SL, target x2)' },
  CHOT: { label: 'Hồi',  cls: 'tc-zone--chot', title: 'Giá đã hồi lên EMA34 → không còn là điểm gom đáy (chốt theo target x2 ở tab DCA)' },
  CHO:  { label: 'Chờ',  cls: 'tc-zone--cho',  title: 'Chưa vào vùng đáy chất lượng hoặc chưa qua cổng dcaScore' },
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

type DetailTab = 'overview' | 'dca' | 'history' | 'journal';

const DETAIL_TABS: ReadonlyArray<[DetailTab, string]> = [
  ['overview', 'Overview'],
  ['dca', 'DCA position'],
  ['history', 'History'],
  ['journal', 'Journal'],
];

function CoinDetailModal({ coin, initialTab, livePrice, onChanged, onClose }: {
  coin: TrackingCoinRow;
  initialTab: DetailTab;
  livePrice: number | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>(initialTab);

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
          {tab === 'dca' && <DcaPositionPanel symbol={coin.symbol} livePrice={livePrice} onChanged={onChanged} />}
          {tab === 'history' && <CoinSignalHistory symbol={coin.symbol} />}
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
    { tf: 'M30', trend: sig.m30Trend, utBot: sig.utBotM30Bullish, e34: sig.m30Ema34Above, e89: sig.m30Ema89Above, e200: sig.m30Ema200Above, rsi: sig.m30Rsi, vol: sig.m30VolMultiplier },
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

/* ── signal history (DCA change-log) ─────────────────────────────── */

const BUCKET_META: Record<SignalHistoryRow['dcaBucket'], { label: string; cls: string }> = {
  safe:  { label: 'An toàn', cls: 'tc-dca--safe' },
  ok:    { label: 'Khá',     cls: 'tc-dca--ok' },
  risky: { label: 'Rủi ro',  cls: 'tc-dca--risky' },
  avoid: { label: 'Tránh',   cls: 'tc-dca--avoid' },
};

const VERDICT_META: Record<NonNullable<SignalHistoryRow['llmVerdict']>, { label: string; cls: string }> = {
  GIU:      { label: 'Giữ',       cls: 'tc-verdict--hold' },
  GOM_THEM: { label: 'Gom thêm',  cls: 'tc-verdict--add' },
  CHOT_BOT: { label: 'Chốt bớt',  cls: 'tc-verdict--trim' },
  THOAT:    { label: 'Thoát',     cls: 'tc-verdict--exit' },
};

const ENTRY_MODE_LABEL: Record<NonNullable<SignalHistoryRow['entryMode']>, string> = {
  SIGNAL: 'Theo tín hiệu',
  FOMO:   'FOMO',
  MIXED:  'Hỗn hợp',
};

function CoinSignalHistory({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<SignalHistoryRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(false);
    createApiClient().fetchSignalHistory(symbol, 100)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (error) return <p className="scr-muted tc-overview__empty">Không tải được lịch sử.</p>;
  if (rows === null) return <div className="ord-loading"><span className="ord-loading__spinner" /><span>Đang tải…</span></div>;
  if (rows.length === 0) {
    return <p className="scr-muted tc-overview__empty">Chưa có thay đổi nào được ghi nhận. Lịch sử chỉ lưu khi vùng DCA hoặc bậc chất lượng đổi.</p>;
  }

  return (
    <div className="tc-history">
      <p className="scr-muted" style={{ margin: 0, fontSize: '0.78rem', lineHeight: 1.5 }}>
        Mỗi dòng là một lần tín hiệu DCA đổi trạng thái (vùng GOM/Chờ/CHỐT hoặc bậc chất lượng). Dòng có nhãn <b>AI</b> là
        đánh giá vị thế hằng ngày (Claude Haiku) cho coin đang nắm giữ. Mới nhất ở trên.
      </p>
      <table className="dcapos-table tc-history-table">
        <thead>
          <tr><th>Thời điểm</th><th>DCA</th><th>Vùng</th><th>Trend (W/D1/H4)</th><th>RSI</th><th>Ext%</th><th>Giá</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = BUCKET_META[r.dcaBucket];
            const z = r.dcaZone ? ZONE_META[r.dcaZone] : null;
            const v = r.llmVerdict ? VERDICT_META[r.llmVerdict] : null;
            return (
              <Fragment key={r.id}>
                <tr className={v ? 'tc-history-row--ai' : undefined}>
                  <td>{new Date(r.scannedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    <span className={`tc-dca-badge ${b.cls}`}>
                      <span className="tc-dca-score">{r.dcaScore}</span>
                      <span className="tc-dca-tag">{b.label}</span>
                    </span>
                  </td>
                  <td>{z ? <span className={`tc-zone ${z.cls}`} title={z.title}>{z.label}</span> : <span className="scr-muted">—</span>}</td>
                  <td>
                    <span className="tc-history-trends">
                      <TrendBadge trend={r.weekTrend} />
                      <TrendBadge trend={r.trend} />
                      <TrendBadge trend={r.h4Trend} />
                    </span>
                  </td>
                  <td>{r.rsi == null ? <span className="scr-muted">—</span> : Math.round(r.rsi)}</td>
                  <td>{r.extPct == null ? <span className="scr-muted">—</span> : `${r.extPct > 0 ? '+' : ''}${r.extPct.toFixed(1)}%`}</td>
                  <td>{r.price == null ? <span className="scr-muted">—</span> : `$${formatPrice(r.price)}`}</td>
                </tr>
                {v && (
                  <tr className="tc-history-ai">
                    <td colSpan={7}>
                      <div className="tc-ai-review">
                        <span className="tc-ai-tag">AI</span>
                        <span className={`tc-verdict ${v.cls}`}>{v.label}</span>
                        {r.entryMode && <span className="tc-ai-chip">{ENTRY_MODE_LABEL[r.entryMode]}</span>}
                        {r.pnlPct != null && (
                          <span className={`tc-ai-pnl ${r.pnlPct >= 0 ? 'tc-ai-pnl--up' : 'tc-ai-pnl--down'}`}>
                            {r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(1)}%
                          </span>
                        )}
                        {r.avgEntry != null && <span className="tc-ai-chip">Vốn TB ${formatPrice(r.avgEntry)}</span>}
                        {r.llmReview && <span className="tc-ai-text">{r.llmReview}</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
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

/* ── DCA position dialog — buy log, average, P&L, profit-aware chốt ─ */

const DCA_MAX_LAYERS = 3; // bottom-DCA ladder: 3 tiers × −15% (2026-07-12 backtest)

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

function DcaPositionPanel({ symbol, livePrice, onChanged }: {
  symbol: string;
  livePrice: number | null;
  onChanged: () => void;
}) {
  const [pos, setPos] = useState<DcaPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState('');
  const [usd, setUsd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefilledRef = useRef(false);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [portfolioId, setPortfolioId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    createApiClient().fetchDcaPosition(symbol)
      .then((r) => { setPos(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  // Portfolios for the sync dropdown; default to the last one used for this coin.
  useEffect(() => {
    createApiClient().fetchPortfolios()
      .then((ps) => {
        setPortfolios(ps);
        const saved = (typeof window !== 'undefined' && window.localStorage.getItem(`dca-portfolio:${symbol}`)) || '';
        setPortfolioId(ps.some((p) => p.id === saved) ? saved : (ps[0]?.id ?? ''));
      })
      .catch(() => {});
  }, [symbol]);

  const portfolioName = (id: string | null) =>
    id ? (portfolios.find((p) => p.id === id)?.name ?? '—') : '—';

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
      const r = await createApiClient().addDcaBuy(symbol, { price: p, usd: u, ...(portfolioId ? { portfolioId } : {}) });
      if (portfolioId && typeof window !== 'undefined') window.localStorage.setItem(`dca-portfolio:${symbol}`, portfolioId);
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
    const def = cur > 0 ? priceInputStr(cur) : '';
    const input = window.prompt(
      `Chốt toàn bộ DCA ${symbol} — nhập giá bán (tạo lệnh SELL trong portfolio, ghi nhận lãi/lỗ):`,
      def,
    );
    if (input == null) return; // cancelled
    const sell = parseFloat(input);
    if (!(sell > 0)) { setError('Giá bán không hợp lệ.'); return; }
    setBusy(true); setError(null);
    try { const r = await createApiClient().closeDcaPosition(symbol, sell); setPos(r); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Lỗi chốt.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="setup-body">
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

              {avg != null && (() => {
                const target = avg * 2; // full exit at x2 (+100%) — the backtested sweet spot
                const hitTarget = livePnlPct != null && livePnlPct >= 100;
                return (
                  <p className={`dcapos-hint ${hitTarget ? 'dcapos-hint--ok' : 'dcapos-hint--warn'}`}>
                    {hitTarget
                      ? `✓ Đã đạt target x2 ($${fmtNum(target)}) → CHỐT TOÀN BỘ.`
                      : `🎯 Target CHỐT: x2 = $${fmtNum(target)} (+100% từ giá TB${livePnlPct != null ? `, còn ${(100 - livePnlPct).toFixed(0)}%` : ''}). Gom đáy, ôm tới x2 — no SL.`}
                    {pos?.nextAddPrice != null && ` · Gom layer kế ở ~$${fmtNum(pos.nextAddPrice)} (−15%).`}
                  </p>
                );
              })()}

              {/* portfolio sync target */}
              {portfolios.length > 0 ? (
                <label className="dcapos-portfolio">
                  <span>Đồng bộ vào portfolio</span>
                  <select className="setup-input" value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
                    {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              ) : (
                <p className="scr-muted" style={{ fontSize: '0.75rem' }}>Chưa có portfolio — lệnh gom sẽ không đồng bộ.</p>
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
                  <thead><tr><th>Ngày</th><th>Giá</th><th>USD</th><th>Portfolio</th><th></th></tr></thead>
                  <tbody>
                    {pos.buys.map((b) => (
                      <tr key={b.id}>
                        <td>{b.boughtAt.slice(0, 10)}</td>
                        <td>${fmtNum(b.price)}</td>
                        <td>${b.usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                        <td className="dcapos-pf">{b.portfolioId ? portfolioName(b.portfolioId) : <span className="scr-muted">—</span>}</td>
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
  const [showInfo, setShowInfo] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('all');
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all');
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('all');
  const [holdingOnly, setHoldingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [confirmRemoveSymbol, setConfirmRemoveSymbol] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<TrackingCoinRow | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [chatCoin, setChatCoin] = useState<TrackingCoinRow | null>(null);

  useEffect(() => { setPage(1); }, [nameFilter, sortKey, zoneFilter, qualityFilter, trendFilter, holdingOnly]);

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

  // Coins after the text + holding filters — used both for the visible list and
  // for the per-facet chip counts so the numbers track the current search.
  const base = useMemo(() => {
    const q = nameFilter.trim().toUpperCase();
    return coins.filter((c) =>
      (!q || c.symbol.includes(q) || c.name.toUpperCase().includes(q)) &&
      (!holdingOnly || c.dcaPosition != null)
    );
  }, [coins, nameFilter, holdingOnly]);

  const zoneCounts = useMemo(() => {
    const c: Record<ZoneFilter, number> = { all: base.length, GOM: 0, CHO: 0, CHOT: 0 };
    for (const x of base) { const z = x.signal?.accZone; if (z) c[z] += 1; }
    return c;
  }, [base]);

  const qualityCounts = useMemo(() => {
    const c: Record<QualityFilter, number> = { all: base.length, safe: 0, ok: 0, risky: 0, avoid: 0 };
    for (const x of base) if (x.signal) c[dcaBucketKey(x.signal.dcaScore)] += 1;
    return c;
  }, [base]);

  const trendCounts = useMemo(() => {
    const c: Record<TrendFilter, number> = { all: base.length, up: 0, side: 0, down: 0 };
    for (const x of base) if (x.signal) c[trendGroup(x.signal.trend)] += 1;
    return c;
  }, [base]);

  const holdingCount = useMemo(() => coins.filter((c) => c.dcaPosition != null).length, [coins]);

  const sorted = useMemo(() => {
    const filtered = base.filter((c) => {
      const sig = c.signal;
      if (zoneFilter !== 'all' && sig?.accZone !== zoneFilter) return false;
      if (qualityFilter !== 'all' && (sig == null || dcaBucketKey(sig.dcaScore) !== qualityFilter)) return false;
      if (trendFilter !== 'all' && (sig == null || trendGroup(sig.trend) !== trendFilter)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === 'dca') return (b.signal?.dcaScore ?? -Infinity) - (a.signal?.dcaScore ?? -Infinity);
      if (sortKey === 'ext') return (b.signal?.extPct ?? -Infinity) - (a.signal?.extPct ?? -Infinity);
      if (sortKey === 'mktcap') return (b.marketCap ?? -Infinity) - (a.marketCap ?? -Infinity);
      if (sortKey === 'rsi') return (b.signal?.rsi ?? 0) - (a.signal?.rsi ?? 0);
      if (sortKey === 'vol') return (b.signal?.volMultiplier ?? 0) - (a.signal?.volMultiplier ?? 0);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [base, sortKey, zoneFilter, qualityFilter, trendFilter]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      {selectedCoin && (
        <CoinDetailModal
          key={selectedCoin.symbol}
          coin={selectedCoin}
          initialTab={detailTab}
          livePrice={prices.get(selectedCoin.symbol) ?? null}
          onChanged={reloadCoins}
          onClose={() => setSelectedCoin(null)}
        />
      )}
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
      {showInfo && <StrategyInfoDialog onClose={() => setShowInfo(false)} />}

      <main className="dashboard-shell scr-shell">
        {/* header */}
        <div className="tc-page-header">
          <div className="tc-page-header-left">
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
            <p className="tc-page-header-sub">
              Gom vùng đáy mạnh (giảm 50–85% + nền đi ngang) qua cổng dcaScore≥50 · spot, no SL · ladder 3×−15% · target CHỐT x2 ·{' '}
              {sorted.length < coins.length
                ? `${sorted.length} / ${coins.length} coins hiển thị`
                : `${coins.length} coins`}
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
        <div className="tc-filters">
          <input
            className="scr-search tc-filter-search"
            type="search"
            placeholder="Tìm symbol / tên…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />

          <div className="tc-chip-row">
            {ZONE_FILTERS.filter((f) => f.key !== 'all').map((f) => (
              <button
                key={f.key}
                className={`ts-filter${zoneFilter === f.key ? ' is-active' : ''}`}
                onClick={() => setZoneFilter((v) => (v === f.key ? 'all' : f.key))}
              >
                {f.label} <span className="ts-filter-count">{zoneCounts[f.key]}</span>
              </button>
            ))}
            {QUALITY_FILTERS.filter((f) => f.key !== 'all').map((f) => (
              <button
                key={f.key}
                className={`ts-filter${qualityFilter === f.key ? ' is-active' : ''}`}
                onClick={() => setQualityFilter((v) => (v === f.key ? 'all' : f.key))}
              >
                {f.label} <span className="ts-filter-count">{qualityCounts[f.key]}</span>
              </button>
            ))}
            {TREND_FILTERS.filter((f) => f.key !== 'all').map((f) => (
              <button
                key={f.key}
                className={`ts-filter${trendFilter === f.key ? ' is-active' : ''}`}
                onClick={() => setTrendFilter((v) => (v === f.key ? 'all' : f.key))}
              >
                {f.label} <span className="ts-filter-count">{trendCounts[f.key]}</span>
              </button>
            ))}
            <button
              className={`ts-filter${holdingOnly ? ' is-active' : ''}`}
              onClick={() => setHoldingOnly((v) => !v)}
              title="Chỉ hiện coin đang ôm vị thế DCA"
            >
              Holding <span className="ts-filter-count">{holdingCount}</span>
            </button>
          </div>
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
                  <tr key={coin.id} className="scr-row" onClick={() => { setDetailTab('overview'); setSelectedCoin(coin); }} style={{ cursor: 'pointer' }}>
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
                      <DcaCell score={sig?.dcaScore} zone={sig?.accZone} />
                    </td>
                    {/* Trend W / D1 / H4 */}
                    <td className="scr-td">
                      {sig
                        ? <TfStack
                            w={<TrendBadge trend={sig.weekTrend} />}
                            d1={<TrendBadge trend={sig.trend} />}
                            h4={<TrendBadge trend={sig.h4Trend} />}
                            m30={<TrendBadge trend={sig.m30Trend} />}
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
                            m30={<UtBotBadge bullish={sig.utBotM30Bullish} />}
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
                            m30={<EmaPips e34={sig.m30Ema34Above} e89={sig.m30Ema89Above} e200={sig.m30Ema200Above} />}
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
                            m30={<RsiCell rsi={sig.m30Rsi} />}
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
                            m30={<VolCell vol={sig.m30VolMultiplier} />}
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
                        <button className={`tt-btn tt-btn--dca${coin.dcaPosition ? ' tt-btn--dca-active' : ''}`} data-tooltip={coin.dcaPosition ? `Đang ôm ${coin.dcaPosition.layers}L` : 'DCA position'} aria-label={`DCA position ${coin.symbol}`} onClick={() => { setDetailTab('dca'); setSelectedCoin(coin); }}>
                          {coin.dcaPosition ? `${coin.dcaPosition.layers}L` : <IconLayers />}
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
