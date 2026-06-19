'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { createApiClient } from '@web/shared/api/client';
import type { DayTradingSignal, DayTradingStats, DayTradingSettings } from '@web/shared/api/types';

// Lazy-load the shared TipTap editor so its bundle only loads when a note opens.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

type Props = {
  initialSignals: DayTradingSignal[];
  initialStats: DayTradingStats;
  initialSettings: DayTradingSettings;
};

type StatusFilter = 'ALL' | 'ACTIVE' | 'TP_HIT' | 'SL_HIT';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Open',
  TP_HIT: 'TP Hit',
  SL_HIT: 'SL Hit',
  MANUAL_CLOSE: 'Đóng tay',
  EXPIRED: 'Expired',
};

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'dt-badge--active',
  TP_HIT: 'dt-badge--tp',
  SL_HIT: 'dt-badge--sl',
  MANUAL_CLOSE: 'dt-badge--expired',
  EXPIRED: 'dt-badge--expired',
};

const SETUP_LABEL: Record<string, string> = {
  BREAK_RETEST: 'Break & Retest',
  LIQUIDITY_SWEEP: 'Liq. Sweep',
  TREND_PULLBACK: 'Trend Pullback',
  RANGE_FADE: 'Range Fade',
};

function formatPrice(p: number) {
  return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

type SetupInfo = { method: string; how: string; reason: string; exit: string };

function num(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function volMult(o: Record<string, unknown>, key: string): string | null {
  const vol = num(o, key);
  const avg = num(o, 'avg20Volume');
  return vol != null && avg != null && avg > 0 ? (vol / avg).toFixed(1) : null;
}

/** Reconstruct the exact entry rationale + methodology from the persisted setup context. */
function describeSetup(signal: DayTradingSignal): SetupInfo {
  let ctx: Record<string, unknown> = {};
  try { ctx = JSON.parse(signal.setupJson) as Record<string, unknown>; } catch { /* ignore */ }
  const trend = `Xu hướng 4H=${String(ctx.trend4h ?? '—')}, 1H=${String(ctx.trend1h ?? '—')}`;
  const rr = `R:R 1:${signal.rrRatio.toFixed(1)}`;
  const lvl = (v: number | null) => (v != null ? formatPrice(v) : '?');

  if (signal.setupType === 'LIQUIDITY_SWEEP') {
    const vm = volMult(ctx, 'candleVolume');
    const volTxt = vm ? `, volume ${vm}× trung bình 20 nến` : '';
    const pct = ctx.sweepPct != null ? `${ctx.sweepPct}%` : null;
    if (signal.direction === 'LONG') {
      return {
        method: 'Liquidity Sweep + Reversal',
        how: 'Giá phá xuống giả qua đáy 1H để quét stop-loss, rồi đóng nến trở lại trên đáy — bẫy phe bán và đảo chiều tăng.',
        reason: `Quét xuống dưới đáy 1H ${lvl(num(ctx, 'swingLow'))}${pct ? ` (-${pct})` : ''} rồi đóng nến tăng (bullish engulfing / râu nến dưới dài) trở lại trên đáy${volTxt}. ${trend}.`,
        exit: `SL ngay dưới đáy quét; TP tại swing high 1H gần nhất phía trên (mục tiêu đảo chiều) — ${rr}.`,
      };
    }
    return {
      method: 'Liquidity Sweep + Reversal',
      how: 'Giá phá lên giả qua đỉnh 1H để quét stop-loss, rồi đóng nến trở lại dưới đỉnh — bẫy phe mua và đảo chiều giảm.',
      reason: `Quét lên trên đỉnh 1H ${lvl(num(ctx, 'swingHigh'))}${pct ? ` (+${pct})` : ''} rồi đóng nến giảm (bearish engulfing / râu nến trên dài) trở lại dưới đỉnh${volTxt}. ${trend}.`,
      exit: `SL ngay trên đỉnh quét; TP tại swing low 1H gần nhất phía dưới (mục tiêu đảo chiều) — ${rr}.`,
    };
  }

  if (signal.setupType === 'TREND_PULLBACK') {
    if (signal.direction === 'LONG') {
      return {
        method: 'Trend Pullback (trendline)',
        how: 'Thuận xu hướng tăng (trendline H4 dốc lên, đáy sau cao hơn đáy trước): chờ giá hồi về đáy swing gần nhất rồi đóng nến tăng lấy lại → vào lệnh tiếp diễn.',
        reason: `Xu hướng tăng theo trendline H4, giá hồi về đáy swing gần nhất ${lvl(num(ctx, 'pullbackLow'))} rồi đóng nến xanh lấy lại. ${trend}.`,
        exit: `SL dưới đáy swing gần nhất + buffer; TP tại vùng S/R mạnh phía trên hoặc mục tiêu RR — ${rr}.`,
      };
    }
    return {
      method: 'Trend Pullback (trendline)',
      how: 'Thuận xu hướng giảm (trendline H4 dốc xuống, đỉnh sau thấp hơn đỉnh trước): chờ giá hồi lên đỉnh swing gần nhất rồi đóng nến giảm bị từ chối → vào lệnh tiếp diễn.',
      reason: `Xu hướng giảm theo trendline H4, giá hồi lên đỉnh swing gần nhất ${lvl(num(ctx, 'pullbackHigh'))} rồi đóng nến đỏ bị từ chối. ${trend}.`,
      exit: `SL trên đỉnh swing gần nhất + buffer; TP tại vùng S/R mạnh phía dưới hoặc mục tiêu RR — ${rr}.`,
    };
  }

  if (signal.setupType === 'RANGE_FADE') {
    const band = `biên ${lvl(num(ctx, 'rangeLow'))}–${lvl(num(ctx, 'rangeHigh'))}`;
    if (signal.direction === 'LONG') {
      return {
        method: 'Range Fade (mean reversion)',
        how: 'Thị trường đi ngang (4H neutral): fade biên dưới của range — chọc xuống đáy range rồi đóng nến lấy lại → mua về phía giữa range.',
        reason: `4H đi ngang, giá chọc đáy ${band} rồi đóng nến tăng lấy lại biên dưới. Kỳ vọng hồi về giữa range ${lvl(num(ctx, 'rangeMid'))}.`,
        exit: `SL dưới đáy range; TP tại giữa range hoặc mục tiêu RR — ${rr}.`,
      };
    }
    return {
      method: 'Range Fade (mean reversion)',
      how: 'Thị trường đi ngang (4H neutral): fade biên trên của range — chọc lên đỉnh range rồi đóng nến bị từ chối → bán về phía giữa range.',
      reason: `4H đi ngang, giá chọc đỉnh ${band} rồi đóng nến giảm bị từ chối tại biên trên. Kỳ vọng hồi về giữa range ${lvl(num(ctx, 'rangeMid'))}.`,
      exit: `SL trên đỉnh range; TP tại giữa range hoặc mục tiêu RR — ${rr}.`,
    };
  }

  // Legacy BREAK_RETEST rows (no longer generated).
  const vm = volMult(ctx, 'breakCandleVolume');
  const volTxt = vm ? ` với volume ${vm}× trung bình 20 nến` : '';
  if (signal.direction === 'LONG') {
    return {
      method: 'Break & Retest',
      how: 'Giá phá vỡ kháng cự kèm volume cao, quay lại retest đúng mức vừa phá rồi đóng nến xác nhận → tiếp diễn xu hướng.',
      reason: `Phá vỡ kháng cự 1H ${lvl(num(ctx, 'resistance'))}${volTxt}, retest thành công và đóng nến trên mức này → tiếp diễn tăng (thuận xu hướng 4H). ${trend}.`,
      exit: `SL dưới đáy vùng retest; TP tại swing high 1H gần nhất phía trên (mục tiêu tiếp diễn) — ${rr}.`,
    };
  }
  return {
    method: 'Break & Retest',
    how: 'Giá phá vỡ hỗ trợ kèm volume cao, quay lại retest đúng mức vừa phá rồi đóng nến xác nhận → tiếp diễn xu hướng.',
    reason: `Phá vỡ hỗ trợ 1H ${lvl(num(ctx, 'support'))}${volTxt}, retest từ dưới và đóng nến dưới mức này → tiếp diễn giảm (thuận xu hướng 4H). ${trend}.`,
    exit: `SL trên đỉnh vùng retest; TP tại swing low 1H gần nhất phía dưới (mục tiêu tiếp diễn) — ${rr}.`,
  };
}

function PriceCell({ label, value, modifier, sub }: { label: string; value: string; modifier?: string; sub?: string }) {
  return (
    <div className="dt-price">
      <span className="dt-price-label">{label}</span>
      <span className={`dt-price-value${modifier ? ` ${modifier}` : ''}`}>{value}</span>
      {sub && <span className="dt-price-sub">{sub}</span>}
    </div>
  );
}

/** Markdown trader note attached to a signal — available for any status (active or closed). */
function NoteBlock({ signal }: { signal: DayTradingSignal }) {
  const [note, setNote] = useState<string>(signal.note ?? '');
  const [baseline, setBaseline] = useState<string>(signal.note ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = note !== baseline;

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await createApiClient().updateDayTradingSignalNote(signal.id, note);
      setBaseline(note);
      setSaved(true);
    } catch { /* ignore — leave dirty so the user can retry */ } finally {
      setSaving(false);
    }
  };

  return (
    <details className="dt-note" open={!!baseline}>
      <summary className="dt-note-summary">📝 Ghi chú{baseline ? ' · đã lưu' : ''}</summary>
      <div className="dt-note-body">
        <MarkdownEditor
          value={note}
          onChange={(val) => { setNote(val); setSaved(false); }}
          placeholder="Ghi chú cho lệnh này (lý do vào, cảm nhận, bài học)…"
          minHeight={120}
        />
        <button type="button" className="dt-note-save" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Đang lưu…' : saved ? 'Đã lưu ✓' : 'Lưu ghi chú'}
        </button>
      </div>
    </details>
  );
}

function CloseButton({ signal, onClosed }: { signal: DayTradingSignal; onClosed: () => void }) {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    if (!window.confirm(`Đóng lệnh ${signal.direction} ${signal.symbol} theo giá thị trường ngay bây giờ?`)) return;
    setClosing(true);
    setError(null);
    try {
      await createApiClient().closeDayTradingSignal(signal.id);
      onClosed();
    } catch {
      setError('Đóng lệnh thất bại — lệnh có thể đã đóng. Thử lại.');
      setClosing(false);
    }
  };

  return (
    <div className="dt-close-action">
      <button type="button" className="dt-close-btn" onClick={() => void close()} disabled={closing}>
        {closing ? 'Đang đóng…' : '✕ Đóng lệnh (market)'}
      </button>
      {error && <span className="dt-close-error">{error}</span>}
    </div>
  );
}

function SignalCard({ signal, livePrice, onClosed }: { signal: DayTradingSignal; livePrice: number | null; onClosed: () => void }) {
  const riskPct = ((Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100).toFixed(2);
  const pnl = signal.pnlUsd;
  const isActive = signal.status === 'ACTIVE';
  const info = describeSetup(signal);

  // Live, unrealized P&L for an open position (only when we have a fresh price).
  const live = isActive && livePrice != null
    ? (() => {
        const move = signal.direction === 'LONG' ? livePrice - signal.entryPrice : signal.entryPrice - livePrice;
        const riskPerUnit = Math.abs(signal.entryPrice - signal.stopLoss);
        const upnl = signal.quantity != null ? signal.quantity * move : null;
        const rMultiple = riskPerUnit > 0 ? move / riskPerUnit : 0;
        const toTp = ((Math.abs(signal.takeProfit - livePrice) / livePrice) * 100).toFixed(2);
        const toSl = ((Math.abs(signal.stopLoss - livePrice) / livePrice) * 100).toFixed(2);
        return { upnl, rMultiple, toTp, toSl };
      })()
    : null;

  return (
    <div className="dt-card">
      <div className="dt-card-head">
        <span className="dt-symbol">{signal.symbol}</span>
        <span className={`dt-badge ${signal.direction === 'LONG' ? 'dt-badge--long' : 'dt-badge--short'}`}>
          {signal.direction}
        </span>
        <span className="dt-badge dt-badge--setup">{SETUP_LABEL[signal.setupType] ?? signal.setupType}</span>
        <span className={`dt-badge ${STATUS_CLASS[signal.status] ?? 'dt-badge--expired'}`}>
          {STATUS_LABEL[signal.status] ?? signal.status}
        </span>
        {signal.breakEvenMoved && (
          <span className="dt-badge dt-badge--setup" title="Giá đã đạt +1R → SL đã kéo về điểm hoà vốn (entry)">
            🛡 SL hoà vốn
          </span>
        )}
        <span className={`dt-badge ${signal.mode === 'LIVE' ? 'dt-badge--live' : 'dt-badge--paper'}`}>
          {signal.mode === 'LIVE' ? 'LIVE' : 'PAPER'}
        </span>
        {pnl != null ? (
          <span className={`dt-pnl ${pnl >= 0 ? 'dt-pnl--pos' : 'dt-pnl--neg'}`}>
            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
          </span>
        ) : live?.upnl != null ? (
          <span className={`dt-pnl ${live.upnl >= 0 ? 'dt-pnl--pos' : 'dt-pnl--neg'}`} title="Unrealized P&L (live)">
            ~{live.upnl >= 0 ? '+' : '-'}${Math.abs(live.upnl).toFixed(2)} · {live.rMultiple >= 0 ? '+' : ''}{live.rMultiple.toFixed(2)}R
          </span>
        ) : null}
      </div>

      {isActive && livePrice != null && live && (
        <div className="dt-live">
          <span className="dt-live-dot" />
          <span className="dt-live-label">Live</span>
          <span className="dt-live-price">{formatPrice(livePrice)}</span>
          <span className="dt-live-dist">→ TP {live.toTp}% · SL {live.toSl}%</span>
        </div>
      )}

      <div className="dt-prices">
        <PriceCell label="Entry" value={formatPrice(signal.entryPrice)} />
        <PriceCell
          label="Stop Loss"
          value={formatPrice(signal.stopLoss)}
          modifier="dt-price-value--sl"
          sub={signal.breakEvenMoved ? 'đã về hoà vốn (BE)' : `-${riskPct}%`}
        />
        <PriceCell label="Take Profit" value={formatPrice(signal.takeProfit)} modifier="dt-price-value--tp" />
        <PriceCell label="R:R" value={`1:${signal.rrRatio.toFixed(1)}`} modifier="dt-price-value--rr" />
      </div>

      {signal.closedPrice != null && (
        <div className="dt-closed">
          Closed @ {formatPrice(signal.closedPrice)}{signal.closedAt ? ` · ${formatTime(signal.closedAt)}` : ''}
        </div>
      )}

      <details className="dt-why">
        <summary className="dt-why-summary">Vì sao vào lệnh · {info.method}</summary>
        <div className="dt-why-body">
          <p><span className="dt-why-tag">Phương pháp</span>{info.how}</p>
          <p><span className="dt-why-tag">Lý do vào lệnh</span>{info.reason}</p>
          <p><span className="dt-why-tag">Kế hoạch thoát</span>{info.exit}</p>
          <p><span className="dt-why-tag">Quản lý lệnh</span>Khi giá chạy đến +1R (lãi bằng đúng mức rủi ro ban đầu), tự động kéo SL về điểm hoà vốn (entry) — từ đó lệnh xấu nhất chỉ hoà, khoá rủi ro về 0.</p>
        </div>
      </details>

      <NoteBlock signal={signal} />

      <div className="dt-meta">
        Detected {formatTime(signal.detectedAt)} · Vol {signal.quantity != null ? `${signal.quantity.toFixed(6)} BTC` : '—'}
        {signal.positionValue != null ? ` (~$${signal.positionValue.toFixed(0)})` : ''} · Risk ${signal.riskAmount.toFixed(0)}
      </div>

      {isActive && <CloseButton signal={signal} onClosed={onClosed} />}
    </div>
  );
}

function StatCard({ label, value, modifier }: { label: string; value: string | number; modifier?: string }) {
  return (
    <div className="dt-stat">
      <div className="dt-stat-label">{label}</div>
      <div className={`dt-stat-value${modifier ? ` ${modifier}` : ''}`}>{value}</div>
    </div>
  );
}

function StatsHeader({ stats }: { stats: DayTradingStats }) {
  const totalPnlUsd = stats.totalPnlUsd;
  return (
    <div className="dt-stats">
      <StatCard label="Signals" value={stats.total} />
      <StatCard label="Open" value={stats.active} modifier="dt-stat-value--accent" />
      <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} modifier={stats.winRate >= 50 ? 'dt-stat-value--pos' : 'dt-stat-value--neg'} />
      <StatCard
        label="TP / SL"
        value={`${stats.tpHit} / ${stats.slHit - stats.scratch}${stats.scratch > 0 ? ` · BE ${stats.scratch}` : ''}`}
      />
      <StatCard
        label="Total P&L"
        value={`${totalPnlUsd >= 0 ? '+' : '-'}$${Math.abs(totalPnlUsd).toFixed(2)}`}
        modifier={totalPnlUsd >= 0 ? 'dt-stat-value--pos' : 'dt-stat-value--neg'}
      />
    </div>
  );
}

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Open', value: 'ACTIVE' },
  { label: 'TP Hit', value: 'TP_HIT' },
  { label: 'SL Hit', value: 'SL_HIT' },
];

const SETTING_FIELDS: { key: keyof DayTradingSettings; label: string; hint: string; step: number; min: number }[] = [
  { key: 'riskPerTrade', label: 'Rủi ro mỗi lệnh (USDT)', hint: 'Lỗ cứng khi chạm SL', step: 0.5, min: 0.1 },
  { key: 'minRR', label: 'R:R tối thiểu (R)', hint: 'Chỉ vào lệnh nếu R:R (theo TP phân tích) ≥ giá trị này', step: 0.5, min: 0.1 },
  { key: 'maxTradesPerDay', label: 'Số lệnh tối đa/ngày', hint: 'Dừng vào lệnh khi đạt', step: 1, min: 1 },
  { key: 'maxLossesPerDay', label: 'Số lệnh lỗ tối đa/ngày', hint: 'Dừng ngày khi đủ số lệnh SL', step: 1, min: 1 },
];

function SettingsPanel({
  settings,
  onSaved,
  onClose,
}: {
  settings: DayTradingSettings;
  onSaved: (s: DayTradingSettings) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DayTradingSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await createApiClient().updateDayTradingSettings(form);
      onSaved(saved);
      onClose();
    } catch {
      setError('Lưu thất bại, thử lại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dt-settings">
      <div className="dt-settings-grid">
        {SETTING_FIELDS.map((f) => (
          <label key={f.key} className="dt-setting">
            <span className="dt-setting-label">{f.label}</span>
            <input
              className="dt-setting-input"
              type="number"
              step={f.step}
              min={f.min}
              value={form[f.key]}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
            />
            <span className="dt-setting-hint">{f.hint}</span>
          </label>
        ))}
      </div>
      {error && <div className="dt-settings-error">{error}</div>}
      <div className="dt-settings-actions">
        <button className="dt-filter" onClick={onClose} disabled={saving}>Hủy</button>
        <button className="dt-filter dt-filter--active" onClick={() => void save()} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </button>
      </div>
    </div>
  );
}

export function DayTradingFeed({ initialSignals, initialStats, initialSettings }: Props) {
  const [signals, setSignals] = useState<DayTradingSignal[]>(initialSignals);
  const [stats, setStats] = useState<DayTradingStats>(initialStats);
  const [settings, setSettings] = useState<DayTradingSettings>(initialSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [loading, setLoading] = useState(false);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  const hasActive = signals.some((s) => s.status === 'ACTIVE');

  // Poll the live BTC price every 5s — but only while an open position exists,
  // so closed-only views don't keep hitting the endpoint.
  useEffect(() => {
    if (!hasActive) {
      setLivePrice(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const { price } = await createApiClient().fetchDayTradingPrice();
        if (!cancelled) setLivePrice(price > 0 ? price : null);
      } catch { /* ignore — keep last price */ }
    };
    void tick();
    const id = setInterval(() => void tick(), 5_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [hasActive]);

  const refresh = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    try {
      const api = createApiClient();
      const [res, newStats] = await Promise.all([
        api.fetchDayTradingSignals({ status: status === 'ALL' ? undefined : status, limit: 50 }),
        api.fetchDayTradingStats(),
      ]);
      setSignals(res.data);
      setStats(newStats);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 60s to pick up new signals and result updates
  useEffect(() => {
    const id = setInterval(() => { void refresh(filter); }, 60_000);
    return () => clearInterval(id);
  }, [filter, refresh]);

  const handleFilter = (f: StatusFilter) => {
    setFilter(f);
    void refresh(f);
  };

  return (
    <div className="dt-page">
      <div className="dt-header">
        <div>
          <h1 className="dt-title">Day Trading — BTCUSDT</h1>
          <p className="dt-subtitle">
            Risk ${settings.riskPerTrade} · R:R ≥ {settings.minRR} · max {settings.maxTradesPerDay} lệnh / {settings.maxLossesPerDay} lỗ /ngày
          </p>
        </div>
        <div className="dt-header-actions">
          <button className="dt-refresh" onClick={() => setShowSettings((v) => !v)}>
            ⚙ Cấu hình
          </button>
          <button className="dt-refresh" onClick={() => void refresh(filter)} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSaved={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      <StatsHeader stats={stats} />

      <div className="dt-filters">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilter(f.value)}
            className={`dt-filter${filter === f.value ? ' dt-filter--active' : ''}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {signals.length === 0 ? (
        <div className="dt-empty">
          No signals yet. The scanner checks for setups after each 15m candle close.
        </div>
      ) : (
        <div className="dt-list">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} livePrice={livePrice} onClosed={() => void refresh(filter)} />
          ))}
        </div>
      )}
    </div>
  );
}
