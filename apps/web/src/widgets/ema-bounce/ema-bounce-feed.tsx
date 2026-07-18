'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient, resolveApiBaseUrl } from '@web/shared/api/client';
import type { EmaBounceCoin, EmaBounceSignal, EmaBounceMatch, PaTrend, SwingStructure } from '@web/shared/api/types';

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const STAGE_META: Record<string, { label: string; cls: string }> = {
  near: { label: '⏳ Gần thoả mãn', cls: 'eb-badge-near' },
  reach: { label: '🟢 Thoả mãn', cls: 'eb-badge-reach' },
  risk: { label: '🔔 Gần TP', cls: 'eb-badge-risk' },
};

/** Badge for a persisted card: closed states win, otherwise show the monitoring stage. */
function badgeFor(s: { status: string; stage: string }): { label: string; cls: string } {
  if (s.status === 'hit_tp') return { label: 'Đã chạm TP +10%', cls: 'eb-badge-tp' };
  if (s.status === 'expired') return { label: 'Hết hạn', cls: 'eb-badge-exp' };
  return STAGE_META[s.stage] ?? STAGE_META.reach!;
}

/** Colour band for the 0–100 completeness score: hot ≥70, warm ≥40, else cold. */
function scoreCls(score: number): string {
  if (score >= 70) return 'eb-score-hot';
  if (score >= 40) return 'eb-score-warm';
  return 'eb-score-cold';
}

function tfLabel(tf: string): string {
  return tf === '1d' ? '1D' : tf === '4h' ? '4H' : tf.toUpperCase();
}

/**
 * Human-readable StochRSI reading: zone (quá bán/quá mua) + momentum direction
 * (%K above %D = đà tăng). Turns raw "%K 9.3 / %D 5.4" into "Quá bán, đà tăng ↑".
 */
function stochLabel(k: number | null | undefined, d: number | null | undefined): string {
  if (k == null || d == null || !Number.isFinite(k) || !Number.isFinite(d)) return '—';
  const zone =
    k < 20 ? 'Quá bán' : k < 30 ? 'Gần quá bán' : k > 80 ? 'Quá mua' : k > 70 ? 'Gần quá mua' : 'Trung tính';
  const dir = k > d ? 'đà tăng ↑' : k < d ? 'đà giảm ↓' : 'đi ngang';
  return `${zone}, ${dir}`;
}

/* ── Price action badges ──────────────────────────────────────────
 * The setup is a LONG bought into a downtrend, so the entry timeframe's own trend says
 * nothing. These two reads carry the PA block's 20 points: the HIGHER timeframe's trend
 * (is this a pullback or a knife?) and the entry timeframe's swing structure (has it
 * stopped making lower lows?). Mirrors /tracking-coins' trend badges.
 */
const HTF_TREND_META: Record<PaTrend, { label: string; cls: string; pts: number }> = {
  StrongUp:   { label: '↑↑', cls: 'eb-pa--strong-up',   pts: 12 },
  Up:         { label: '↑',  cls: 'eb-pa--up',          pts: 10 },
  Neutral:    { label: '→',  cls: 'eb-pa--neutral',     pts: 6 },
  Down:       { label: '↓',  cls: 'eb-pa--down',        pts: 3 },
  StrongDown: { label: '↓↓', cls: 'eb-pa--strong-down', pts: 0 },
};

const STRUCTURE_META: Record<SwingStructure, { label: string; desc: string; cls: string; pts: number }> = {
  HH_HL: { label: 'HH+HL', desc: 'Đỉnh & đáy đều cao dần — cấu trúc đã đảo chiều', cls: 'eb-pa--strong-up',   pts: 8 },
  LH_HL: { label: 'LH+HL', desc: 'Đáy cao dần, đỉnh còn thấp dần — đang nén, đáy hình thành', cls: 'eb-pa--up', pts: 6 },
  Mixed: { label: 'Mixed', desc: 'Swing bằng nhau / cấu trúc chưa rõ', cls: 'eb-pa--neutral',  pts: 4 },
  HH_LL: { label: 'HH+LL', desc: 'Biên độ mở rộng — chưa ổn định', cls: 'eb-pa--down',        pts: 2 },
  LH_LL: { label: 'LH+LL', desc: 'Còn phá đáy — dao đang rơi', cls: 'eb-pa--strong-down',      pts: 0 },
};

/** Which timeframe a card's PA context is read on: a 4H setup is judged against D1, a D1 against W1. */
function htfLabelOf(tf: string): string {
  return tf === '1d' ? 'W1' : 'D1';
}

/** The card's PA row — HTF trend + swing structure, each showing what it contributed. */
function PaRow({ timeframe, htfTrend, swingStructure }: {
  timeframe: string;
  htfTrend: PaTrend | null;
  swingStructure: SwingStructure | null;
}) {
  if (!htfTrend && !swingStructure) return null;
  const htf = htfTrend ? HTF_TREND_META[htfTrend] : null;
  const st = swingStructure ? STRUCTURE_META[swingStructure] : null;
  const total = (htf?.pts ?? 0) + (st?.pts ?? 0);
  return (
    <div className="eb-kv" title="Price action: trend khung lớn + cấu trúc swing khung vào lệnh (tối đa 20đ trong tổng điểm)">
      <span>PA <span className="eb-pa-pts">{total}/20đ</span></span>
      <span className="eb-pa-row">
        {htf && (
          <span className={`eb-pa ${htf.cls}`} title={`Trend ${htfLabelOf(timeframe)} — ${htf.pts}đ`}>
            {htfLabelOf(timeframe)} {htf.label}
          </span>
        )}
        {st && (
          <span className={`eb-pa ${st.cls}`} title={`${st.desc} — ${st.pts}đ`}>
            {st.label}
          </span>
        )}
      </span>
    </div>
  );
}

/** What to plot when the "Xem chart" dialog opens. */
type ChartTarget = {
  symbol: string;
  timeframe: string;
  label: string;
  focusTime?: number; // ms — center the window on the setup candle
  entry?: number;
  tp?: number;
};

/** Builds the API URL for the full-indicator chart PNG. */
function chartUrl(t: ChartTarget): string {
  const params = new URLSearchParams({ symbol: t.symbol, timeframe: t.timeframe });
  if (t.focusTime != null) params.set('focusTime', String(t.focusTime));
  if (t.entry != null && Number.isFinite(t.entry)) params.set('entry', String(t.entry));
  if (t.tp != null && Number.isFinite(t.tp)) params.set('tp', String(t.tp));
  // Concatenate (don't pass a path to resolveApiBaseUrl — its new URL() drops
  // the "/api-proxy" prefix for absolute paths, sending the request to the web
  // server instead of the API).
  return `${resolveApiBaseUrl()}/ema-bounce/chart?${params.toString()}`;
}

/** Fullscreen chart dialog — portalled to <body> so card backdrop-filters can't trap it. */
function ChartDialog({ target, onClose }: { target: ChartTarget; onClose: () => void }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Fetch the PNG through the app's authenticated fetch path (credentials +
  // no-store so the service worker can't serve a stale/opaque response), then
  // render it as a blob URL — a raw <img src> can 401 or be intercepted.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImgSrc(null);
    setFailed(false);

    // Unique `_t` per open so a service worker can't hand back a stale/failed
    // cached response — forces a fresh network hit every time.
    fetch(`${chartUrl(target)}&_t=${Date.now()}`, { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImgSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--fullscreen eb-chart-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            {target.symbol} <span className="eb-tf">{target.label}</span>
            {target.focusTime == null && <span className="eb-chart-note"> · chart hiện tại</span>}
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body eb-chart-body">
          {failed ? (
            <div className="eb-chart-status">Không tải được chart. Thử lại sau.</div>
          ) : imgSrc ? (
            <img className="eb-chart-img" src={imgSrc} alt={`${target.symbol} ${target.label} chart`} />
          ) : (
            <div className="eb-chart-status">Đang tải chart…</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** How the scanner works — the same explanatory copy, moved into a click-to-open dialog. */
function InfoDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">EMA Bounce Scanner — cách hoạt động</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body">
          <p className="eb-sub eb-sub--dialog">
            LONG khi giá dưới cụm <b>EMA34&lt;89&lt;200</b>, giãn <b>7–15%</b> dưới EMA34 và StochRSI %K
            cắt lên %D trong vùng quá bán. TP <b>+10%</b>, không cắt lỗ. Worker tự quét khung <b>4H</b> (mỗi 4h)
            và <b>D1</b> (mỗi ngày).
          </p>
          <p className="eb-sub eb-sub--dialog">
            Card hiện <b>sớm</b> khi coin ở dưới EMA34 + đạt <b>ít nhất 1</b> tín hiệu, kèm <b>điểm 0–100</b> theo mức độ
            hoàn thiện:
          </p>
          <ul className="eb-score-list">
            <li><b>Stack</b> — cụm EMA34&lt;89&lt;200 đúng thứ tự: <b>15đ</b></li>
            <li><b>Giãn</b> — giá cách EMA34 7–15%: <b>20đ</b> / một phần <b>10đ</b></li>
            <li><b>Quá bán</b> — StochRSI trong vùng quá bán: <b>20đ</b> / gần <b>10đ</b></li>
            <li><b>Cắt lên</b> — %K cắt lên %D: <b>25đ</b> / sắp cắt <b>12đ</b></li>
            <li><b>PA</b> — trend khung lớn + cấu trúc swing: <b>20đ</b></li>
          </ul>
          <p className="eb-sub eb-sub--dialog">
            Điểm càng cao, setup càng gần chuẩn — sắp theo điểm giảm dần.
          </p>
          <p className="eb-sub eb-sub--dialog">
            <b>PA (20đ)</b> — setup này vốn là bắt đáy trong downtrend, nên trend của chính khung vào lệnh không có ý
            nghĩa. Hai thứ được chấm là <b>trend khung lớn</b> (12đ — card 4H đọc D1, card 1D đọc W1: ↑↑ 12 · ↑ 10 ·
            → 6 · ↓ 3 · ↓↓ 0) và <b>cấu trúc swing</b> khung vào lệnh (8đ — HH+HL 8 · LH+HL 6 · Mixed 4 · HH+LL 2 ·
            LH+LL 0). Bắt đáy <b>thuận</b> khung lớn là nhịp chỉnh; <b>ngược</b> khung lớn là bắt dao rơi — vẫn hiện
            card nhưng điểm thấp nên không bắn Telegram.
          </p>
          <p className="eb-sub eb-sub--dialog">
            Giai đoạn: <b className="eb-near">⏳ Gần thoả mãn</b> → <b className="eb-reach">🟢 Thoả mãn</b> (đủ điều kiện
            vào lệnh) → <b className="eb-risk">🔔 Gần TP</b>. Telegram chỉ báo khi <b>điểm ≥ 70</b> hoặc lên thoả mãn/gần TP.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Manage-watchlist dialog: input to add a new coin + full list of tracked coins with delete. */
function ManageCoinsDialog({ coins, onAdd, onRemove, busy, onClose }: {
  coins: EmaBounceCoin[];
  onAdd: (sym: string) => Promise<void>;
  onRemove: (sym: string) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [newSymbol, setNewSymbol] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    setLocalError(null);
    try {
      await onAdd(sym);
      setNewSymbol('');
    } catch {
      setLocalError(`Không thêm được ${sym}`);
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Quản lý coin theo dõi ({coins.length})</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body">
          <div className="eb-row">
            <input
              className="eb-input"
              placeholder="Thêm coin (VD: SOL)"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              disabled={busy}
              autoFocus
            />
            <button className="eb-btn eb-btn-primary" onClick={submit} disabled={busy}>Thêm</button>
          </div>
          {localError && <div className="eb-error eb-manage-error">{localError}</div>}
          <div className="eb-manage-list">
            {coins.length === 0 ? (
              <p className="eb-muted">Chưa có coin nào trong danh sách theo dõi.</p>
            ) : (
              coins.map((c) => (
                <div key={c.id} className="eb-manage-item">
                  <span className="eb-manage-sym">{c.symbol}</span>
                  <button className="eb-manage-x" onClick={() => onRemove(c.symbol)} disabled={busy} title="Xoá">
                    Xoá
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Checkbox dropdown to filter the signal feed by one or more coins (empty = all). */
function CoinMultiSelect({ coins, selected, onChange }: {
  coins: EmaBounceCoin[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const label = selected.length === 0 ? 'Mọi coin' : `${selected.length} coin`;

  function toggle(sym: string) {
    onChange(selected.includes(sym) ? selected.filter((s) => s !== sym) : [...selected, sym]);
  }

  return (
    <div className="eb-ms" ref={ref}>
      <button type="button" className="eb-select eb-ms-btn" onClick={() => setOpen((o) => !o)}>
        {label} <span className="eb-ms-caret">▾</span>
      </button>
      {open && (
        <div className="eb-ms-panel">
          {coins.length === 0 ? (
            <div className="eb-ms-empty">Chưa có coin</div>
          ) : (
            <>
              {selected.length > 0 && (
                <button type="button" className="eb-ms-clear" onClick={() => onChange([])}>Bỏ chọn tất cả</button>
              )}
              {coins.map((c) => (
                <label key={c.id} className="eb-ms-item">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.symbol)}
                    onChange={() => toggle(c.symbol)}
                  />
                  {c.symbol}
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function EmaBounceFeed({
  initialCoins,
  initialSignals,
}: {
  initialCoins: EmaBounceCoin[];
  initialSignals: EmaBounceSignal[];
}) {
  const api = createApiClient();
  const [coins, setCoins] = useState<EmaBounceCoin[]>(initialCoins);
  const [signals, setSignals] = useState<EmaBounceSignal[]>(initialSignals);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmaBounceMatch[] | null>(null);
  const [showOpenOnly, setShowOpenOnly] = useState(false);
  const [tfFilter, setTfFilter] = useState<'all' | '4h' | '1d'>('all');
  const [stageFilter, setStageFilter] = useState<'all' | 'near' | 'reach' | 'risk'>('all');
  const [minScore, setMinScore] = useState(0);
  const [coinFilter, setCoinFilter] = useState<string[]>([]);
  const [chartTarget, setChartTarget] = useState<ChartTarget | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showManage, setShowManage] = useState(false);

  // Throws on failure so ManageCoinsDialog can surface its own error inline.
  async function addCoin(sym: string) {
    setBusy(true);
    try {
      const coin = await api.addEmaBounceCoin(sym);
      setCoins((prev) => (prev.some((c) => c.symbol === coin.symbol) ? prev : [...prev, coin]));
    } finally {
      setBusy(false);
    }
  }

  async function removeCoin(symbol: string) {
    setBusy(true);
    try {
      await api.removeEmaBounceCoin(symbol);
      setCoins((prev) => prev.filter((c) => c.symbol !== symbol));
      setCoinFilter((prev) => prev.filter((s) => s !== symbol));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSignals() {
    setBusy(true);
    try {
      setSignals(await api.fetchEmaBounceSignals(showOpenOnly));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.previewEmaBounce();
      setPreview(res.matches);
    } catch {
      setError('Quét thất bại');
    } finally {
      setBusy(false);
    }
  }

  const shown = signals
    .filter((s) => (showOpenOnly ? s.status === 'open' : true))
    .filter((s) => (tfFilter === 'all' ? true : s.timeframe === tfFilter))
    .filter((s) => (stageFilter === 'all' ? true : s.stage === stageFilter))
    .filter((s) => (coinFilter.length === 0 ? true : coinFilter.includes(s.symbol)))
    .filter((s) => s.score >= minScore)
    .slice()
    .sort((a, b) => b.score - a.score);

  return (
    <div className="eb-page">
      <header className="eb-header">
        <div className="eb-title-row">
          <h1 className="eb-title">EMA Bounce Scanner</h1>
          <button
            type="button"
            className="eb-info-btn"
            onClick={() => setShowInfo(true)}
            aria-label="Thông tin về cách hoạt động"
            title="Cách hoạt động"
          >
            ⓘ
          </button>
        </div>
      </header>

      {error && <div className="eb-error">{error}</div>}

      {/* Live preview matches */}
      {preview && (
        <section className="eb-card">
          <h2 className="eb-h2">Gần / khớp ngay bây giờ ({preview.length})</h2>
          {preview.length === 0 ? (
            <p className="eb-muted">Không có coin nào gần hoặc khớp trên nến vừa đóng.</p>
          ) : (
            <div className="eb-grid">
              {preview.map((m) => {
                const meta = STAGE_META[m.stage] ?? STAGE_META.reach!;
                return (
                  <div key={`${m.symbol}-${m.timeframe}`} className="eb-mini">
                    <div className="eb-mini-head">
                      <b>{m.symbol} <span className="eb-tf">{tfLabel(m.timeframe)}</span></b>
                      <span className={`eb-badge ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <div className="eb-kv"><span>Điểm</span><span className={`eb-score-inline ${scoreCls(m.score)}`}>{m.score}đ</span></div>
                    <div className="eb-kv"><span>Giá</span><span>{fmtPrice(m.price)}</span></div>
                    <div className="eb-kv"><span>Cách EMA34</span><span className="eb-red">-{(m.distPct * 100).toFixed(1)}%</span></div>
                    <div className="eb-kv"><span>StochRSI</span><span>{stochLabel(m.stochK, m.stochD)}<span className="eb-stoch-num"> ({m.stochK.toFixed(1)}/{m.stochD.toFixed(1)})</span></span></div>
                    <div className="eb-kv"><span>TP +10%</span><span className="eb-green">{fmtPrice(m.tpPrice)}</span></div>
                    <PaRow timeframe={m.timeframe} htfTrend={m.htfTrend} swingStructure={m.swingStructure} />
                    {m.note && <div className="eb-signal-note">{m.note}</div>}
                    <button
                      className="eb-chart-btn"
                      onClick={() => setChartTarget({
                        symbol: m.symbol,
                        timeframe: m.timeframe,
                        label: tfLabel(m.timeframe),
                        entry: m.price,
                        tp: m.tpPrice,
                      })}
                    >
                      📈 Xem chart
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="eb-note">Đây là bản xem nhanh (không lưu). Card &amp; Telegram do worker tạo mỗi 4h.</p>
        </section>
      )}

      {/* Signal cards */}
      <section className="eb-card">
        <div className="eb-row eb-between">
          <h2 className="eb-h2">Tín hiệu ({shown.length})</h2>
          <div className="eb-row">
            <CoinMultiSelect coins={coins} selected={coinFilter} onChange={setCoinFilter} />
            <select className="eb-select" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
              <option value={0}>Mọi điểm</option>
              <option value={40}>Điểm ≥ 40</option>
              <option value={55}>Điểm ≥ 55</option>
              <option value={70}>Điểm ≥ 70</option>
            </select>
            <select className="eb-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as 'all' | 'near' | 'reach' | 'risk')}>
              <option value="all">Mọi giai đoạn</option>
              <option value="near">⏳ Gần thoả mãn</option>
              <option value="reach">🟢 Thoả mãn</option>
              <option value="risk">🔔 Gần TP</option>
            </select>
            <select className="eb-select" value={tfFilter} onChange={(e) => setTfFilter(e.target.value as 'all' | '4h' | '1d')}>
              <option value="all">Tất cả khung</option>
              <option value="4h">4H</option>
              <option value="1d">1D</option>
            </select>
            <label className="eb-check">
              <input type="checkbox" checked={showOpenOnly} onChange={(e) => setShowOpenOnly(e.target.checked)} />
              Chỉ đang mở
            </label>
            <button className="eb-btn" onClick={() => setShowManage(true)} disabled={busy}>Quản lý coin</button>
            <button className="eb-btn" onClick={runPreview} disabled={busy || coins.length === 0}>Quét ngay</button>
            <button className="eb-btn" onClick={refreshSignals} disabled={busy}>Làm mới</button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="eb-muted">Chưa có tín hiệu nào. Worker sẽ quét vào lần đóng nến 4h kế tiếp.</p>
        ) : (
          <div className="eb-grid">
            {shown.map((s) => {
              const st = badgeFor(s);
              const pnl = s.pnlPct ?? 0;
              return (
                <div key={s.id} className="eb-signal">
                  <div className="eb-signal-head">
                    <b className="eb-signal-sym">{s.symbol} <span className="eb-tf">{tfLabel(s.timeframe)}</span></b>
                    <span className={`eb-badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="eb-signal-topline">
                    <div className="eb-signal-pnl" style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}>
                      {fmtPct(pnl)}
                    </div>
                    <div className={`eb-score ${scoreCls(s.score)}`} title="Điểm hoàn thiện setup 0–100">
                      {s.score}<span className="eb-score-u">đ</span>
                    </div>
                  </div>
                  <div className="eb-kv"><span>{s.stage === 'near' ? 'Giá canh' : 'Vào lệnh'}</span><span>{fmtPrice(s.entryPrice)}</span></div>
                  <div className="eb-kv"><span>Hiện tại</span><span>{fmtPrice(s.currentPrice)}</span></div>
                  <div className="eb-kv"><span>TP +10%</span><span className="eb-green">{fmtPrice(s.tpPrice)}</span></div>
                  <div className="eb-kv"><span>Cách EMA34</span><span className="eb-red">-{(s.distPct * 100).toFixed(1)}%</span></div>
                  <div className="eb-kv"><span>RSI</span><span>{s.rsi != null ? s.rsi.toFixed(1) : '—'}</span></div>
                  <div className="eb-kv" title="StochRSI: %K là đường nhanh, %D là đường tín hiệu chậm. %K trên %D = đà tăng.">
                    <span>StochRSI</span>
                    <span>{stochLabel(s.stochK, s.stochD)}{s.stochK != null && <span className="eb-stoch-num"> ({s.stochK.toFixed(1)}/{s.stochD?.toFixed(1)})</span>}</span>
                  </div>
                  <PaRow timeframe={s.timeframe} htfTrend={s.htfTrend} swingStructure={s.swingStructure} />
                  {s.note && <div className="eb-signal-note">{s.note}</div>}
                  <div className="eb-kv eb-kv-time"><span>Kích hoạt</span><span>{fmtTime(s.triggeredAt)}</span></div>
                  <button
                    className="eb-chart-btn"
                    onClick={() => setChartTarget({
                      symbol: s.symbol,
                      timeframe: s.timeframe,
                      label: tfLabel(s.timeframe),
                      focusTime: new Date(s.triggeredAt).getTime(),
                      entry: s.entryPrice,
                      tp: s.tpPrice,
                    })}
                  >
                    📈 Xem chart
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {chartTarget && (
        <ChartDialog target={chartTarget} onClose={() => setChartTarget(null)} />
      )}

      {showInfo && <InfoDialog onClose={() => setShowInfo(false)} />}

      {showManage && (
        <ManageCoinsDialog
          coins={coins}
          onAdd={addCoin}
          onRemove={removeCoin}
          busy={busy}
          onClose={() => setShowManage(false)}
        />
      )}
    </div>
  );
}
