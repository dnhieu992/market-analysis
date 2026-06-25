'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { createApiClient } from '@web/shared/api/client';
import type { LongSignal, LongSignalStats, LongSignalSettings, LongSignalLiveStatus } from '@web/shared/api/types';

// Lazy-load the shared TipTap editor so its bundle only loads when a note opens.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

type Props = {
  initialSignals: LongSignal[];
  initialStats: LongSignalStats;
  initialSettings: LongSignalSettings;
};

type StatusFilter = 'ALL' | 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'FORCE_CLOSE';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Open',
  TP_HIT: 'TP Hit',
  SL_HIT: 'SL bảo hiểm',
  FORCE_CLOSE: 'Đóng theo giờ',
  MANUAL_CLOSE: 'Đóng tay',
  FAILED: 'Lỗi đặt lệnh',
};

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'dt-badge--active',
  TP_HIT: 'dt-badge--tp',
  SL_HIT: 'dt-badge--sl',
  FORCE_CLOSE: 'dt-badge--expired',
  MANUAL_CLOSE: 'dt-badge--expired',
  FAILED: 'dt-badge--sl',
};

function formatPrice(p: number) {
  const d = p >= 1000 ? 1 : p >= 1 ? 3 : 5;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
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

/** Markdown trader note attached to a signal — available for any status. */
function NoteBlock({ signal }: { signal: LongSignal }) {
  const [note, setNote] = useState<string>(signal.note ?? '');
  const [baseline, setBaseline] = useState<string>(signal.note ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = note !== baseline;

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await createApiClient().updateLongSignalNote(signal.id, note);
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

function CloseButton({ signal, onClosed }: { signal: LongSignal; onClosed: () => void }) {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    if (!window.confirm(`Đóng lệnh LONG ${signal.symbol} theo giá thị trường ngay bây giờ?`)) return;
    setClosing(true);
    setError(null);
    try {
      await createApiClient().closeLongSignal(signal.id);
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

function SignalCard({ signal, livePrice, onClosed }: { signal: LongSignal; livePrice: number | null; onClosed: () => void }) {
  const tpPct = ((signal.takeProfit - signal.entryPrice) / signal.entryPrice) * 100;
  const slPct = ((signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
  const pnl = signal.pnlUsd;
  const isActive = signal.status === 'ACTIVE';

  // Live, unrealized P&L for an open position (only when we have a fresh price).
  const live = isActive && livePrice != null
    ? (() => {
        const move = livePrice - signal.entryPrice;
        const upnl = signal.quantity != null ? signal.quantity * move : null;
        const movePct = (move / signal.entryPrice) * 100;
        const toTp = ((Math.abs(signal.takeProfit - livePrice) / livePrice) * 100).toFixed(2);
        return { upnl, movePct, toTp };
      })()
    : null;

  return (
    <div className="dt-card">
      <div className="dt-card-head">
        <span className="dt-symbol">{signal.symbol}</span>
        <span className="dt-badge dt-badge--long">LONG</span>
        <span className="dt-badge dt-badge--setup">M30 UTBot</span>
        <span className={`dt-badge ${STATUS_CLASS[signal.status] ?? 'dt-badge--expired'}`}>
          {STATUS_LABEL[signal.status] ?? signal.status}
        </span>
        <span className={`dt-badge ${signal.mode === 'LIVE' ? 'dt-badge--live' : 'dt-badge--paper'}`}>
          {signal.mode === 'LIVE' ? 'LIVE' : 'PAPER'}
        </span>
        {pnl != null ? (
          <span className={`dt-pnl ${pnl >= 0 ? 'dt-pnl--pos' : 'dt-pnl--neg'}`}>
            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
          </span>
        ) : live?.upnl != null ? (
          <span className={`dt-pnl ${live.upnl >= 0 ? 'dt-pnl--pos' : 'dt-pnl--neg'}`} title="Unrealized P&L (live)">
            ~{live.upnl >= 0 ? '+' : '-'}${Math.abs(live.upnl).toFixed(2)} · {live.movePct >= 0 ? '+' : ''}{live.movePct.toFixed(2)}%
          </span>
        ) : null}
      </div>

      {isActive && livePrice != null && live && (
        <div className="dt-live">
          <span className="dt-live-dot" />
          <span className="dt-live-label">Live</span>
          <span className="dt-live-price">{formatPrice(livePrice)}</span>
          <span className="dt-live-dist">→ còn {live.toTp}% tới TP</span>
        </div>
      )}

      <div className="dt-prices">
        <PriceCell label="Entry" value={formatPrice(signal.entryPrice)} />
        <PriceCell label="Take Profit" value={formatPrice(signal.takeProfit)} modifier="dt-price-value--tp" sub={`+${tpPct.toFixed(1)}%`} />
        <PriceCell label="SL bảo hiểm" value={formatPrice(signal.stopLoss)} modifier="dt-price-value--sl" sub={`-${slPct.toFixed(1)}%`} />
        <PriceCell label="Vốn" value={`$${(signal.positionValue ?? 0).toFixed(0)}`} modifier="dt-price-value--rr" />
      </div>

      {signal.closedPrice != null && (
        <div className="dt-closed">
          Closed @ {formatPrice(signal.closedPrice)}{signal.closedAt ? ` · ${formatTime(signal.closedAt)}` : ''}
        </div>
      )}

      <details className="dt-why">
        <summary className="dt-why-summary">Vì sao vào lệnh · LONG FOMO + lọc M30 UTBot</summary>
        <div className="dt-why-body">
          <p><span className="dt-why-tag">Phương pháp</span>Mỗi ngày vào lệnh LONG theo giờ cố định, nhưng chỉ khi xu hướng UTBot khung M30 đang là <b>tăng (bull)</b> — bộ lọc tránh các phiên giảm.</p>
          <p><span className="dt-why-tag">Lý do vào lệnh</span>Cây M30 đã đóng gần nhất có UTBot (kv={signal.keyValue}) báo bull{signal.entryLineDistancePct != null ? `, giá cách đường trend ${signal.entryLineDistancePct.toFixed(2)}%` : ''} → mở LONG.</p>
          <p><span className="dt-why-tag">Kế hoạch thoát</span>TP cố định +{tpPct.toFixed(1)}%; nếu không chạm sẽ bị đóng bắt buộc theo giờ. SL bảo hiểm rộng (-{slPct.toFixed(1)}%) chỉ để chặn rủi ro thảm họa — backtest gốc không có SL.</p>
        </div>
      </details>

      <NoteBlock signal={signal} />

      <div className="dt-meta">
        Detected {formatTime(signal.detectedAt)} · Vol {signal.quantity != null ? signal.quantity.toFixed(6) : '—'}
        {signal.positionValue != null ? ` (~$${signal.positionValue.toFixed(0)})` : ''}
        {signal.brokerOrderId ? ` · order ${signal.brokerOrderId}` : ''}
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

function StatsHeader({ stats }: { stats: LongSignalStats }) {
  const totalPnlUsd = stats.totalPnlUsd;
  return (
    <div className="dt-stats">
      <StatCard label="Signals" value={stats.total} />
      <StatCard label="Open" value={stats.active} modifier="dt-stat-value--accent" />
      <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} modifier={stats.winRate >= 50 ? 'dt-stat-value--pos' : 'dt-stat-value--neg'} />
      <StatCard label="TP / SL / Giờ" value={`${stats.tpHit} / ${stats.slHit} / ${stats.forceClose}`} />
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
  { label: 'SL', value: 'SL_HIT' },
  { label: 'Đóng giờ', value: 'FORCE_CLOSE' },
];

const SETTING_FIELDS: { key: keyof LongSignalSettings; label: string; hint: string; step: number; min: number }[] = [
  { key: 'notional', label: 'Vốn mỗi lệnh (USDT)', hint: 'Notional cố định/coin/ngày', step: 10, min: 1 },
  { key: 'tpPct', label: 'Take Profit (%)', hint: 'Chốt lời khi giá tăng đủ %', step: 0.5, min: 0.1 },
  { key: 'keyValue', label: 'UTBot keyValue', hint: 'Độ nhạy lọc trend M30 (backtest tốt nhất = 1)', step: 0.5, min: 0.1 },
  { key: 'atrPeriod', label: 'ATR period', hint: 'Chu kỳ ATR của UTBot', step: 1, min: 2 },
  { key: 'catastropheStopPct', label: 'SL bảo hiểm (%)', hint: 'Stop thảm họa rộng (LIVE)', step: 0.5, min: 0.5 },
  { key: 'entryHour', label: 'Giờ vào (UTC)', hint: '0 = 07:00 giờ VN', step: 1, min: 0 },
  { key: 'exitHour', label: 'Giờ đóng (UTC)', hint: '8 = 15:00 giờ VN', step: 1, min: 0 },
  { key: 'leverage', label: 'Đòn bẩy', hint: 'Không ảnh hưởng lời/lỗ, chỉ ký quỹ', step: 1, min: 1 },
];

function SettingsPanel({
  settings,
  onSaved,
  onClose,
}: {
  settings: LongSignalSettings;
  onSaved: (s: LongSignalSettings) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<LongSignalSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await createApiClient().updateLongSignalSettings(form);
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
              value={form[f.key] as number}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
            />
            <span className="dt-setting-hint">{f.hint}</span>
          </label>
        ))}
        <label className="dt-setting">
          <span className="dt-setting-label">Rổ coin</span>
          <input
            className="dt-setting-input"
            type="text"
            value={form.symbols}
            onChange={(e) => setForm((prev) => ({ ...prev, symbols: e.target.value }))}
          />
          <span className="dt-setting-hint">Phân tách bằng dấu phẩy</span>
        </label>
      </div>
      <div className="dt-settings-note">
        PAPER/LIVE điều khiển bằng công tắc ở đầu trang. Lệnh thật luôn đặt theo ký quỹ <b>cô lập (isolated)</b>.
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

/**
 * Reason LIVE is selected but real orders still won't fire (server not armed),
 * or null when armed / status unknown. Rendered as a banner under the header.
 */
function liveWarn(liveStatus: LongSignalLiveStatus | null): string | null {
  if (!liveStatus || liveStatus.armed) return null;
  if (!liveStatus.envEnabled) return 'Server chưa bật env LIVE_TRADING_ENABLED';
  if (!liveStatus.bitgetConfigured) return 'Thiếu API key Bitget trên server';
  return 'Server chưa sẵn sàng cho LIVE';
}

/**
 * Header on/off switch for LIVE trading. Flips the DB `mode` between PAPER and
 * LIVE (persisted immediately). Pure presentational pill — the "not armed"
 * warning lives in a separate banner so the header row stays clean.
 */
function LiveToggle({
  mode,
  busy,
  onToggle,
}: {
  mode: 'PAPER' | 'LIVE';
  busy: boolean;
  onToggle: () => void;
}) {
  const isLive = mode === 'LIVE';
  return (
    <button
      type="button"
      className={`dt-livetoggle-btn${isLive ? ' dt-livetoggle-btn--on' : ''}`}
      onClick={onToggle}
      disabled={busy}
      aria-pressed={isLive}
      title="Bật/tắt giao dịch thật trên Bitget"
    >
      <span className="dt-livetoggle-knob" />
      <span className="dt-livetoggle-text">{busy ? 'Đang đổi…' : isLive ? 'LIVE: BẬT' : 'LIVE: TẮT'}</span>
    </button>
  );
}

export function LongSignalFeed({ initialSignals, initialStats, initialSettings }: Props) {
  const [signals, setSignals] = useState<LongSignal[]>(initialSignals);
  const [stats, setStats] = useState<LongSignalStats>(initialStats);
  const [settings, setSettings] = useState<LongSignalSettings>(initialSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('ACTIVE');
  const [loading, setLoading] = useState(false);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [liveStatus, setLiveStatus] = useState<LongSignalLiveStatus | null>(null);
  const [togglingMode, setTogglingMode] = useState(false);

  const hasActive = signals.some((s) => s.status === 'ACTIVE');

  // Aggregate live unrealized P&L across open positions (only those with a fresh price + known qty).
  let unrealizedPnl: number | null = null;
  for (const s of signals) {
    if (s.status !== 'ACTIVE' || s.quantity == null) continue;
    const price = prices[s.symbol];
    if (price == null) continue;
    unrealizedPnl = (unrealizedPnl ?? 0) + s.quantity * (price - s.entryPrice);
  }

  // Load the server LIVE arm-state (env gate + Bitget creds) for the header toggle.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await createApiClient().fetchLongSignalLiveStatus();
        if (!cancelled) setLiveStatus(s);
      } catch { /* ignore — toggle still works, just no warning */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleMode = useCallback(async () => {
    const next: 'PAPER' | 'LIVE' = settings.mode === 'LIVE' ? 'PAPER' : 'LIVE';
    if (next === 'LIVE') {
      const armWarn = liveStatus && !liveStatus.armed
        ? '\n\n⚠️ Server chưa kích hoạt LIVE (env/credentials) nên lệnh vẫn chạy PAPER cho tới khi bật.'
        : '';
      if (!window.confirm(`Bật GIAO DỊCH THẬT (LIVE)?\nBot sẽ đặt lệnh thật trên Bitget (ký quỹ cô lập).${armWarn}`)) return;
    }
    setTogglingMode(true);
    try {
      const saved = await createApiClient().updateLongSignalSettings({ mode: next });
      setSettings(saved);
    } catch { /* ignore — leave mode unchanged */ } finally {
      setTogglingMode(false);
    }
  }, [settings.mode, liveStatus]);

  // Poll the basket prices every 5s — only while an open position exists.
  useEffect(() => {
    if (!hasActive) {
      setPrices({});
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const { prices: p } = await createApiClient().fetchLongSignalPrices();
        if (!cancelled) setPrices(p);
      } catch { /* ignore — keep last prices */ }
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
        api.fetchLongSignals({ status: status === 'ALL' ? undefined : status, limit: 50 }),
        api.fetchLongSignalStats(),
      ]);
      setSignals(res.data);
      setStats(newStats);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  // Server pre-fetches all statuses, but the default filter is "Open" (ACTIVE).
  // Refresh once on mount so the rendered list matches the active filter.
  useEffect(() => {
    void refresh('ACTIVE');
  }, [refresh]);

  // Auto-refresh every 60s to pick up new signals and result updates
  useEffect(() => {
    const id = setInterval(() => { void refresh(filter); }, 60_000);
    return () => clearInterval(id);
  }, [filter, refresh]);

  const handleFilter = (f: StatusFilter) => {
    setFilter(f);
    void refresh(f);
  };

  const entryVn = (settings.entryHour + 7) % 24;
  const exitVn = (settings.exitHour + 7) % 24;

  return (
    <div className="dt-page">
      <div className="dt-header">
        <div>
          <h1 className="dt-title">Long Signal — {settings.symbols.split(',').map((s) => s.replace('USDT', '')).join(' · ')}</h1>
          <p className="dt-subtitle">
            LONG ${settings.notional} @ {String(settings.entryHour).padStart(2, '0')}:00 UTC ({String(entryVn).padStart(2, '0')}:00 VN) ·
            lọc M30 UTBot kv{settings.keyValue} · TP +{settings.tpPct}% · đóng {String(settings.exitHour).padStart(2, '0')}:00 UTC ({String(exitVn).padStart(2, '0')}:00 VN) · {settings.mode}
          </p>
        </div>
        <div className="dt-header-actions">
          <LiveToggle mode={settings.mode} busy={togglingMode} onToggle={() => void toggleMode()} />
          <button className="dt-refresh" onClick={() => setShowSettings((v) => !v)}>
            ⚙ Cấu hình
          </button>
          <button className="dt-refresh" onClick={() => void refresh(filter)} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {settings.mode === 'LIVE' && liveWarn(liveStatus) && (
        <div className="dt-live-banner">
          <span className="dt-live-banner-icon">⚠️</span>
          <span>{liveWarn(liveStatus)} — bot vẫn chạy <b>PAPER</b> cho tới khi server bật LIVE.</span>
        </div>
      )}

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
        <span className="dt-filters-count">
          Open <strong>{stats.active}</strong>
          {unrealizedPnl != null && (
            <span
              className={`dt-filters-upnl ${unrealizedPnl >= 0 ? 'dt-pnl--pos' : 'dt-pnl--neg'}`}
              title="Unrealized P&L (live, open positions)"
            >
              ~{unrealizedPnl >= 0 ? '+' : '-'}${Math.abs(unrealizedPnl).toFixed(2)}
            </span>
          )}
        </span>
      </div>

      {signals.length === 0 ? (
        <div className="dt-empty">
          Chưa có lệnh nào. Bot quét lúc {String(settings.entryHour).padStart(2, '0')}:00 UTC mỗi ngày và chỉ vào LONG khi M30 UTBot báo bull.
        </div>
      ) : (
        <div className="dt-list">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} livePrice={prices[s.symbol] ?? null} onClosed={() => void refresh(filter)} />
          ))}
        </div>
      )}
    </div>
  );
}
