'use client';

import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { resolveApiBaseUrl, createApiClient } from '@web/shared/api/client';
import type { TrackingCoinRow, PaTrend, OrderSuggestions, OrderSuggestion, TrackingCoinOrder, CoinSetup } from '@web/shared/api/types';
import { TrackingCoinChatDrawer } from '@web/widgets/tracking-coin-chat-drawer/tracking-coin-chat-drawer';
import { CoinJournalPanel } from '@web/widgets/tracking-coin-journal/tracking-coin-journal';

type Props = { initialCoins: TrackingCoinRow[] };
type SortKey = 'rsi' | 'vol' | 'coin';

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

type DetailTab = 'overview' | 'today' | 'history' | 'journal';

const DETAIL_TABS: ReadonlyArray<[DetailTab, string]> = [
  ['overview', 'Overview'],
  ['today', 'Tín hiệu hôm nay'],
  ['history', 'Lịch sử tín hiệu'],
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
          {tab === 'today' && <CoinLiveSignal symbol={coin.symbol} />}
          {tab === 'history' && <CoinHistorySignal symbol={coin.symbol} />}
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

/* ── order suggestions dialog ───────────────────────────────────── */

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(7);
}

function calcLiveVolume(order: OrderSuggestion, maxLoss: number | null): { positionSize: number; positionValue: number } | null {
  if (!maxLoss || maxLoss <= 0) return null;
  const entryMid = (order.entryLow + order.entryHigh) / 2;
  const risk = order.side === 'LONG' ? entryMid - order.sl : order.sl - entryMid;
  if (risk <= 0) return null;
  const positionSize = maxLoss / risk;
  return { positionSize, positionValue: positionSize * entryMid };
}

function OrderCard({ order, label, maxLoss }: { order: OrderSuggestion; label: string; maxLoss: number | null }) {
  const [notes, setNotes] = useState(order.notes ?? '');
  const savedNotesRef = useRef(order.notes ?? '');

  function handleNotesBlur() {
    const val = notes.trim() || null;
    const saved = savedNotesRef.current.trim() || null;
    if (val !== saved) {
      savedNotesRef.current = val ?? '';
      createApiClient().updateOrderNotes(order.id, val).catch(() => {});
    }
  }

  const isLong = order.side === 'LONG';
  const vol = calcLiveVolume(order, maxLoss);
  return (
    <div className="ord-card">
      <div className="ord-card__header">
        <span className="ord-card__title">{label}</span>
        <span className={`tt-side-badge tt-side-badge--${isLong ? 'long' : 'short'}`}>{order.side}</span>
      </div>
      <div className="ord-card__grid">
        <span className="ord-card__label">Vùng entry</span>
        <span className="ord-card__value ord-entry">${fmtPrice(order.entryLow)} – ${fmtPrice(order.entryHigh)}</span>
        <span className="ord-card__label">TP1</span>
        <span className="ord-card__value ord-tp">${fmtPrice(order.tp1)}</span>
        {order.tp2 != null && <>
          <span className="ord-card__label">TP2</span>
          <span className="ord-card__value ord-tp">${fmtPrice(order.tp2)}</span>
        </>}
        <span className="ord-card__label">SL</span>
        <span className="ord-card__value ord-sl">${fmtPrice(order.sl)}</span>
        <span className="ord-card__label">R:R</span>
        <span className="ord-card__value ord-rr">{order.rrRatio.toFixed(1)}×</span>
        {vol && <>
          <span className="ord-card__label">Số lượng</span>
          <span className="ord-card__value">{vol.positionSize < 1 ? vol.positionSize.toFixed(4) : vol.positionSize.toFixed(2)}</span>
          <span className="ord-card__label">Giá trị lệnh</span>
          <span className="ord-card__value">${vol.positionValue.toFixed(2)}</span>
        </>}
      </div>
      <p className="ord-card__rationale">{order.rationale}</p>
      <textarea
        className="ord-card__notes"
        placeholder="Nhận định của bạn…"
        value={notes}
        rows={2}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={handleNotesBlur}
      />
    </div>
  );
}

function NoTradeCard({ label }: { label: string }) {
  return (
    <div className="ord-card ord-card--notrade">
      <div className="ord-card__header">
        <span className="ord-card__title">{label}</span>
        <span className="tt-side-badge tt-side-badge--neutral">NO-TRADE</span>
      </div>
      <p className="ord-card__rationale">
        Không có setup hôm nay — thị trường đi ngang hoặc tín hiệu hai chiều cân bằng. Đứng ngoài để tránh lệnh chất lượng thấp.
      </p>
    </div>
  );
}

function OutcomeBadge({ activated, outcome }: { activated: boolean | null; outcome: string | null }) {
  if (activated === null) return <span className="ord-hist__outcome ord-hist__outcome--pending">Chưa eval</span>;
  if (!activated) return <span className="ord-hist__outcome ord-hist__outcome--miss">Chưa kích hoạt</span>;
  if (outcome === 'tp2') return <span className="ord-hist__outcome ord-hist__outcome--tp">✓ TP2</span>;
  if (outcome === 'tp1') return <span className="ord-hist__outcome ord-hist__outcome--tp">✓ TP1</span>;
  if (outcome === 'sl') return <span className="ord-hist__outcome ord-hist__outcome--sl">✗ SL</span>;
  if (outcome === 'expired') return <span className="ord-hist__outcome ord-hist__outcome--miss">Hết hạn</span>;
  return <span className="ord-hist__outcome ord-hist__outcome--active">Đang chạy</span>;
}

function HistoryNoteCell({ orderId, initialNotes }: { orderId: string; initialNotes: string | null }) {
  const [notes, setNotes] = useState(initialNotes ?? '');
  const savedRef = useRef(initialNotes ?? '');

  function handleBlur() {
    const val = notes.trim() || null;
    const saved = savedRef.current.trim() || null;
    if (val !== saved) {
      savedRef.current = val ?? '';
      createApiClient().updateOrderNotes(orderId, val).catch(() => {});
    }
  }

  return (
    <textarea
      className="ord-hist__notes"
      placeholder="—"
      value={notes}
      rows={1}
      onChange={(e) => setNotes(e.target.value)}
      onBlur={handleBlur}
    />
  );
}

function OrderHistoryTable({ orders }: { orders: TrackingCoinOrder[] }) {
  if (orders.length === 0) {
    return <p className="scr-muted" style={{ textAlign: 'center', padding: '16px 0' }}>Chưa có lệnh nào được lưu. Lệnh sẽ tự động tạo sau mỗi lần quét.</p>;
  }
  const hasVolume = orders.some((o) => o.positionSize != null);
  return (
    <div className="ord-hist-wrap">
      <table className="ord-hist-table">
        <thead>
          <tr>
            <th>Ngày</th>
            <th>Loại</th>
            <th>Side</th>
            <th>Entry</th>
            <th>TP1</th>
            <th>SL</th>
            <th>R:R</th>
            {hasVolume && <th>Vol / $</th>}
            <th>Kết quả</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} title={o.rationale}>
              <td>{o.date}</td>
              <td><span className="ord-hist__type">{o.type}</span></td>
              <td><span className={`tt-side-badge tt-side-badge--${o.side === 'LONG' ? 'long' : 'short'}`}>{o.side}</span></td>
              <td className="ord-hist__price">{fmtPrice(o.entryLow)}–{fmtPrice(o.entryHigh)}</td>
              <td className="ord-hist__price ord-tp">{fmtPrice(o.tp1)}</td>
              <td className="ord-hist__price ord-sl">{fmtPrice(o.sl)}</td>
              <td>{o.rrRatio.toFixed(1)}×</td>
              {hasVolume && (
                <td className="ord-hist__vol">
                  {o.positionSize != null ? (
                    <span title={`$${o.positionValue?.toFixed(2) ?? '—'}`}>
                      {o.positionSize < 1 ? o.positionSize.toFixed(4) : o.positionSize.toFixed(2)}
                      <span className="ord-hist__vol-usd"> ${o.positionValue?.toFixed(0) ?? '—'}</span>
                    </span>
                  ) : <span className="scr-muted">—</span>}
                </td>
              )}
              <td><OutcomeBadge activated={o.activated} outcome={o.outcome} /></td>
              <td><HistoryNoteCell orderId={o.id} initialNotes={o.notes} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoinLiveSignal({ symbol }: { symbol: string }) {
  const [data, setData] = useState<OrderSuggestions | null>(null);
  const [setup, setSetup] = useState<CoinSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const api = createApiClient();
    Promise.all([
      api.fetchOrderSuggestions(symbol),
      api.fetchCoinSetup(symbol).catch(() => null),
    ])
      .then(([orders, coinSetup]) => {
        if (!cancelled) { setData(orders); setSetup(coinSetup); setLoading(false); }
      })
      .catch((err) => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Lỗi tải gợi ý.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => load(), [load]);

  return (
    <div className="tc-signal">
      {loading && (
        <div className="ord-loading">
          <span className="ord-loading__spinner" />
          <span>Đang tính toán lệnh…</span>
        </div>
      )}
      {error && <p className="scr-muted ord-error">{error}</p>}
      {!loading && !error && data && (
        <>
          <div className="ord-price-bar">
            <span className="ord-price-bar__label">Giá hiện tại</span>
            <span className="ord-price-bar__value">${fmtPrice(data.currentPrice)}</span>
            <button className="ord-refresh-btn" onClick={load} title="Làm mới">↻ Làm mới</button>
          </div>
          {data.swing
            ? <OrderCard order={data.swing} label="Swing (2–5 ngày)" maxLoss={setup?.swingMaxLoss ?? null} />
            : <NoTradeCard label="Swing (2–5 ngày)" />}
          {data.scalp
            ? <OrderCard order={data.scalp} label="Day trade (trong ngày)" maxLoss={setup?.daytradeMaxLoss ?? null} />
            : <NoTradeCard label="Day trade (trong ngày)" />}
          <p className="ord-footer">
            Tạo lúc: {new Date(data.generatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
          </p>
        </>
      )}
    </div>
  );
}

function CoinHistorySignal({ symbol }: { symbol: string }) {
  const [history, setHistory] = useState<TrackingCoinOrder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    createApiClient()
      .fetchCoinOrders(symbol)
      .then((res) => { if (!cancelled) { setHistory(res); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Lỗi tải lịch sử.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [symbol]);

  return (
    <div className="tc-signal">
      {loading && (
        <div className="ord-loading">
          <span className="ord-loading__spinner" />
          <span>Đang tải lịch sử…</span>
        </div>
      )}
      {error && <p className="scr-muted ord-error">{error}</p>}
      {!loading && !error && history !== null && <OrderHistoryTable orders={history} />}
    </div>
  );
}

/* ── setup settings dialog ──────────────────────────────────────── */

function CoinSetupDialog({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [form, setForm] = useState<CoinSetup>({ swingMaxLoss: null, swingMinRR: null, daytradeMaxLoss: null, daytradeMinRR: null });
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
                <div className="setup-section__title">Day trade (trong ngày)</div>
                <div className="setup-fields">
                  <label className="setup-label">
                    <span>SL tối đa ($)</span>
                    <input className="setup-input" type="number" min="0" step="1" placeholder="e.g. 5"
                      value={field('daytradeMaxLoss')} onChange={(e) => setField('daytradeMaxLoss', e.target.value)} />
                  </label>
                  <label className="setup-label">
                    <span>R:R tối thiểu</span>
                    <input className="setup-input" type="number" min="0" step="0.1" placeholder="e.g. 2"
                      value={field('daytradeMinRR')} onChange={(e) => setField('daytradeMinRR', e.target.value)} />
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
  const symbols = useMemo(() => coins.map(c => c.symbol), [coins]);
  const { prices, flash } = useLivePrices(symbols);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('coin');
  const [showAddForm, setShowAddForm] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [confirmRemoveSymbol, setConfirmRemoveSymbol] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<TrackingCoinRow | null>(null);
  const [chatCoin, setChatCoin] = useState<TrackingCoinRow | null>(null);
  const [setupCoin, setSetupCoin] = useState<string | null>(null);

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
                <th className="scr-th tc-th--stacked">Trend (PA)</th>
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
                      {prices.has(coin.symbol) && (
                        <span className={`tc-live-price tc-live-price--${flash.get(coin.symbol) ?? 'idle'}`}>
                          ${formatPrice(prices.get(coin.symbol)!)}
                        </span>
                      )}
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
                        <button className="tt-btn tt-btn--ai" data-tooltip="Tạo prompt" aria-label={`Tạo prompt phân tích cho ${coin.symbol}`} onClick={() => setChatCoin(coin)}>
                          <IconPrompt />
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
