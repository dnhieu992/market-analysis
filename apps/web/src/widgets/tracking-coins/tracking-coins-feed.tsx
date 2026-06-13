'use client';

import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { resolveApiBaseUrl, createApiClient } from '@web/shared/api/client';
import type { TrackingCoinRow, PaTrend, SwingStructure, OrderSuggestions, OrderSuggestion, TrackingCoinOrder } from '@web/shared/api/types';
import { TrackingCoinChatDrawer } from '@web/widgets/tracking-coin-chat-drawer/tracking-coin-chat-drawer';
import { TrackingCoinJournal } from '@web/widgets/tracking-coin-journal/tracking-coin-journal';

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

function IconSetup() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <line x1="7" y1="8" x2="7" y2="8.01" /><line x1="12" y1="8" x2="17" y2="8" />
      <line x1="7" y1="12" x2="7" y2="12.01" /><line x1="12" y1="12" x2="17" y2="12" />
      <line x1="7" y1="16" x2="7" y2="16.01" /><line x1="12" y1="16" x2="17" y2="16" />
    </svg>
  );
}

function IconAI() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
      <path d="M12 8v4l3 3" />
    </svg>
  );
}

function IconTrades() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <polyline points="7 10 10 7 13 10 17 6" />
    </svg>
  );
}

function IconJournal() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="13" y2="13" />
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

/* ── order suggestions dialog ───────────────────────────────────── */

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(7);
}

function OrderCard({ order, label }: { order: OrderSuggestion; label: string }) {
  const isLong = order.side === 'LONG';
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
      </div>
      <p className="ord-card__rationale">{order.rationale}</p>
    </div>
  );
}

function OutcomeBadge({ activated, outcome }: { activated: boolean | null; outcome: string | null }) {
  if (activated === null) return <span className="ord-hist__outcome ord-hist__outcome--pending">Chưa eval</span>;
  if (!activated) return <span className="ord-hist__outcome ord-hist__outcome--miss">Chưa kích hoạt</span>;
  if (outcome === 'tp2') return <span className="ord-hist__outcome ord-hist__outcome--tp">✓ TP2</span>;
  if (outcome === 'tp1') return <span className="ord-hist__outcome ord-hist__outcome--tp">✓ TP1</span>;
  if (outcome === 'sl') return <span className="ord-hist__outcome ord-hist__outcome--sl">✗ SL</span>;
  return <span className="ord-hist__outcome ord-hist__outcome--active">Đang chạy</span>;
}

function OrderHistoryTable({ orders }: { orders: TrackingCoinOrder[] }) {
  if (orders.length === 0) {
    return <p className="scr-muted" style={{ textAlign: 'center', padding: '16px 0' }}>Chưa có lệnh nào được lưu. Lệnh sẽ tự động tạo sau mỗi lần quét.</p>;
  }
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
            <th>Kết quả</th>
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
              <td><OutcomeBadge activated={o.activated} outcome={o.outcome} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoinOrderSuggestionsDialog({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [tab, setTab] = useState<'live' | 'history'>('live');
  const [data, setData] = useState<OrderSuggestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TrackingCoinOrder[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    createApiClient()
      .fetchOrderSuggestions(symbol)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Lỗi tải gợi ý.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [symbol]);

  const loadHistory = useCallback(() => {
    if (history !== null) return;
    setHistLoading(true);
    setHistError(null);
    createApiClient()
      .fetchCoinOrders(symbol)
      .then((res) => { setHistory(res); setHistLoading(false); })
      .catch((err) => { setHistError(err instanceof Error ? err.message : 'Lỗi tải lịch sử.'); setHistLoading(false); });
  }, [symbol, history]);

  useEffect(() => { return load(); }, [load]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog ord-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Lệnh limit — {symbol}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="ord-tabs">
          <button className={`ord-tab${tab === 'live' ? ' ord-tab--active' : ''}`} onClick={() => setTab('live')}>Gợi ý live</button>
          <button className={`ord-tab${tab === 'history' ? ' ord-tab--active' : ''}`} onClick={() => setTab('history')}>Lịch sử</button>
        </div>
        <div className="dialog-body ord-body">
          {tab === 'live' && (
            <>
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
                  <OrderCard order={data.swing} label="Swing (2–5 ngày)" />
                  <OrderCard order={data.scalp} label="Day trade (trong ngày)" />
                  <p className="ord-footer">
                    Tạo lúc: {new Date(data.generatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                  </p>
                </>
              )}
            </>
          )}
          {tab === 'history' && (
            <>
              {histLoading && (
                <div className="ord-loading">
                  <span className="ord-loading__spinner" />
                  <span>Đang tải lịch sử…</span>
                </div>
              )}
              {histError && <p className="scr-muted ord-error">{histError}</p>}
              {!histLoading && !histError && history !== null && <OrderHistoryTable orders={history} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── position setup dialog ──────────────────────────────────────── */

type SetupCalc = {
  positionSize: number;
  positionValue: number;
  profitTP1: number;
  profitTP2: number | null;
  actualRR: number;
  meetsMinRR: boolean;
};

function calcSetup(order: OrderSuggestion, maxLoss: number, minRR: number): SetupCalc | null {
  const entryMid = (order.entryLow + order.entryHigh) / 2;
  const riskPerUnit = order.side === 'LONG' ? entryMid - order.sl : order.sl - entryMid;
  if (riskPerUnit <= 0) return null;
  const positionSize  = maxLoss / riskPerUnit;
  const positionValue = positionSize * entryMid;
  const tp1Dist = order.side === 'LONG' ? order.tp1 - entryMid : entryMid - order.tp1;
  const tp2Dist = order.tp2 != null ? (order.side === 'LONG' ? order.tp2 - entryMid : entryMid - order.tp2) : null;
  const profitTP1  = positionSize * tp1Dist;
  const profitTP2  = tp2Dist != null ? positionSize * tp2Dist : null;
  const actualRR   = tp1Dist / riskPerUnit;
  return { positionSize, positionValue, profitTP1, profitTP2, actualRR, meetsMinRR: actualRR >= minRR };
}

function SetupOrderCard({ order, label, maxLoss, minRR }: { order: OrderSuggestion; label: string; maxLoss: number; minRR: number }) {
  const isLong = order.side === 'LONG';
  const calc = calcSetup(order, maxLoss, minRR);
  return (
    <div className={`setup-card${calc && !calc.meetsMinRR ? ' setup-card--warn' : ''}`}>
      <div className="setup-card__header">
        <span className="setup-card__title">{label}</span>
        <span className={`tt-side-badge tt-side-badge--${isLong ? 'long' : 'short'}`}>{order.side}</span>
        {calc && !calc.meetsMinRR && (
          <span className="setup-card__warn">R:R {calc.actualRR.toFixed(2)} &lt; {minRR.toFixed(1)} min</span>
        )}
      </div>
      <div className="setup-card__order">
        <div className="setup-card__row">
          <span className="setup-card__lbl">Vùng entry</span>
          <span>${fmtPrice(order.entryLow)} – ${fmtPrice(order.entryHigh)}</span>
        </div>
        <div className="setup-card__row">
          <span className="setup-card__lbl">TP1</span>
          <span className="ord-tp">${fmtPrice(order.tp1)}</span>
        </div>
        {order.tp2 != null && (
          <div className="setup-card__row">
            <span className="setup-card__lbl">TP2</span>
            <span className="ord-tp">${fmtPrice(order.tp2)}</span>
          </div>
        )}
        <div className="setup-card__row">
          <span className="setup-card__lbl">SL</span>
          <span className="ord-sl">${fmtPrice(order.sl)}</span>
        </div>
      </div>
      {calc ? (
        <div className="setup-card__result">
          <div className="setup-card__row setup-card__row--em">
            <span className="setup-card__lbl">Số lượng</span>
            <span>{calc.positionSize < 1 ? calc.positionSize.toFixed(4) : calc.positionSize.toFixed(2)}</span>
          </div>
          <div className="setup-card__row setup-card__row--em">
            <span className="setup-card__lbl">Giá trị vị thế</span>
            <span>${calc.positionValue.toFixed(2)}</span>
          </div>
          <div className="setup-card__row">
            <span className="setup-card__lbl">Lãi tại TP1</span>
            <span className="ord-tp">+${calc.profitTP1.toFixed(2)}</span>
          </div>
          {calc.profitTP2 != null && (
            <div className="setup-card__row">
              <span className="setup-card__lbl">Lãi tại TP2</span>
              <span className="ord-tp">+${calc.profitTP2.toFixed(2)}</span>
            </div>
          )}
          <div className="setup-card__row">
            <span className="setup-card__lbl">R:R thực tế</span>
            <span className={calc.meetsMinRR ? 'ord-tp' : 'ord-sl'}>{calc.actualRR.toFixed(2)}×</span>
          </div>
        </div>
      ) : (
        <p className="scr-muted" style={{ fontSize: '0.8rem' }}>Không tính được (risk = 0)</p>
      )}
      <p className="ord-card__rationale">{order.rationale}</p>
    </div>
  );
}

function CoinSetupDialog({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [maxLossInput, setMaxLossInput] = useState('10');
  const [minRRInput, setMinRRInput]   = useState('1.5');
  const [orders, setOrders] = useState<OrderSuggestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const maxLoss = Math.max(0.01, parseFloat(maxLossInput) || 10);
  const minRR   = Math.max(0.1,  parseFloat(minRRInput)   || 1.5);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    createApiClient().fetchOrderSuggestions(symbol)
      .then((r) => { if (!cancelled) { setOrders(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Lỗi.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => { return load(); }, [load]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog setup-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Setup lệnh — {symbol}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body setup-body">
          <div className="setup-inputs">
            <label className="setup-label">
              <span>SL tối đa ($)</span>
              <input className="setup-input" type="number" min="0.01" step="1" value={maxLossInput} onChange={(e) => setMaxLossInput(e.target.value)} />
            </label>
            <label className="setup-label">
              <span>R:R tối thiểu</span>
              <input className="setup-input" type="number" min="0.1" step="0.1" value={minRRInput} onChange={(e) => setMinRRInput(e.target.value)} />
            </label>
            <button className="ord-refresh-btn" onClick={load} title="Làm mới">↻</button>
          </div>
          {loading && (
            <div className="ord-loading"><span className="ord-loading__spinner" /><span>Đang tải…</span></div>
          )}
          {error && <p className="scr-muted ord-error">{error}</p>}
          {!loading && !error && orders && (
            <>
              <div className="setup-price-bar">
                <span className="ord-price-bar__label">Giá hiện tại</span>
                <span className="ord-price-bar__value">${fmtPrice(orders.currentPrice)}</span>
              </div>
              <SetupOrderCard order={orders.swing} label="Swing (2–5 ngày)" maxLoss={maxLoss} minRR={minRR} />
              <SetupOrderCard order={orders.scalp} label="Day trade (trong ngày)" maxLoss={maxLoss} minRR={minRR} />
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
  const [journalCoin, setJournalCoin] = useState<TrackingCoinRow | null>(null);
  const [tradesCoin, setTradesCoin] = useState<string | null>(null);
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
      {journalCoin && (
        <TrackingCoinJournal
          symbol={journalCoin.symbol}
          name={journalCoin.name}
          onClose={() => setJournalCoin(null)}
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
      {tradesCoin && <CoinOrderSuggestionsDialog symbol={tradesCoin} onClose={() => setTradesCoin(null)} />}
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
                        <button className="tt-btn tt-btn--journal" data-tooltip="Journal" aria-label={`Journal ${coin.symbol}`} onClick={() => setJournalCoin(coin)}>
                          <IconJournal />
                        </button>
                        <button className="tt-btn tt-btn--ai" data-tooltip="Ask AI" aria-label={`Ask AI về ${coin.symbol}`} onClick={() => setChatCoin(coin)}>
                          <IconAI />
                        </button>
                        <button className="tt-btn tt-btn--trades" data-tooltip="Lệnh" aria-label={`Lệnh ${coin.symbol}`} onClick={() => setTradesCoin(coin.symbol)}>
                          <IconTrades />
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
