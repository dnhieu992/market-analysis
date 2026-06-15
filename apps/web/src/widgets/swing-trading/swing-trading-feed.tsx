'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { createApiClient } from '@web/shared/api/client';
import type { SwingTradingSignal, SwingTradingStats, SwingTradingSettings } from '@web/shared/api/types';

// Lazy-load the shared TipTap editor so its bundle only loads when a note opens.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

type Props = {
  initialSignals: SwingTradingSignal[];
  initialStats: SwingTradingStats;
  initialSettings: SwingTradingSettings;
};

type StatusFilter = 'ALL' | 'ACTIVE' | 'CLOSED';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Đang mở',
  CLOSED: 'Đã đóng',
};

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'dt-badge--active',
  CLOSED: 'dt-badge--expired',
};

function formatPrice(p: number) {
  return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Explain the UTBot stop-and-reverse rationale for a signal. */
function describeSetup(signal: SwingTradingSignal): { method: string; how: string; reason: string; exit: string } {
  const dirVi = signal.direction === 'LONG' ? 'tăng (LONG)' : 'giảm (SHORT)';
  return {
    method: `UTBot Stop-and-Reverse · ${signal.timeframe.toUpperCase()} · kv=${signal.keyValue}`,
    how: 'Theo đường UTBot (ATR trailing stop). Khi nến ĐÓNG vượt qua đường stop → xác nhận đảo trend → vào lệnh và giữ tới khi nến đóng lật ngược lại.',
    reason: `Nến ${signal.timeframe.toUpperCase()} đóng xác nhận trend ${dirVi}: giá đóng ${formatPrice(signal.entryPrice)} ${signal.direction === 'LONG' ? 'trên' : 'dưới'} đường UTBot ${formatPrice(signal.stopLoss)}.`,
    exit: 'Thoát + đảo lệnh khi một nến đóng lật trend (giá đóng cắt qua đường UTBot theo chiều ngược lại). Không có TP cố định.',
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

/** Markdown trader note attached to a signal — available for any status. */
function NoteBlock({ signal }: { signal: SwingTradingSignal }) {
  const [note, setNote] = useState<string>(signal.note ?? '');
  const [baseline, setBaseline] = useState<string>(signal.note ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = note !== baseline;

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await createApiClient().updateSwingTradingSignalNote(signal.id, note);
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

function SignalCard({ signal, livePrice }: { signal: SwingTradingSignal; livePrice: number | null }) {
  const pnl = signal.pnlUsd;
  const isActive = signal.status === 'ACTIVE';
  const info = describeSetup(signal);

  // Live, unrealized P&L for an open position (only when we have a fresh price).
  const live = isActive && livePrice != null
    ? (() => {
        const move = signal.direction === 'LONG' ? livePrice - signal.entryPrice : signal.entryPrice - livePrice;
        const upnl = signal.quantity != null ? signal.quantity * move : null;
        const toFlip = ((Math.abs(signal.stopLoss - livePrice) / livePrice) * 100).toFixed(2);
        return { upnl, toFlip };
      })()
    : null;

  return (
    <div className="dt-card">
      <div className="dt-card-head">
        <span className="dt-symbol">{signal.symbol}</span>
        <span className={`dt-badge ${signal.direction === 'LONG' ? 'dt-badge--long' : 'dt-badge--short'}`}>
          {signal.direction}
        </span>
        <span className="dt-badge dt-badge--setup">{signal.timeframe.toUpperCase()} · kv{signal.keyValue}</span>
        {signal.legKind === 'ADD' && (
          <span className="dt-badge dt-badge--setup" title="Lệnh nhồi pullback (scale-in về đường UTBot)">＋ pullback</span>
        )}
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
            ~{live.upnl >= 0 ? '+' : '-'}${Math.abs(live.upnl).toFixed(2)}
          </span>
        ) : null}
      </div>

      {isActive && livePrice != null && live && (
        <div className="dt-live">
          <span className="dt-live-dot" />
          <span className="dt-live-label">Live</span>
          <span className="dt-live-price">{formatPrice(livePrice)}</span>
          <span className="dt-live-dist">→ cách đường lật {live.toFlip}%</span>
        </div>
      )}

      <div className="dt-prices">
        <PriceCell label="Entry" value={formatPrice(signal.entryPrice)} />
        <PriceCell label="UTBot Stop (lật)" value={formatPrice(signal.stopLoss)} modifier="dt-price-value--sl" />
        <PriceCell label="Vốn" value={`$${signal.riskAmount.toFixed(0)}`} />
        <PriceCell label="Qty" value={signal.quantity != null ? signal.quantity.toFixed(4) : '—'} />
      </div>

      {signal.closedPrice != null && (
        <div className="dt-closed">
          Đóng @ {formatPrice(signal.closedPrice)}{signal.closedAt ? ` · ${formatTime(signal.closedAt)}` : ''}
        </div>
      )}

      <details className="dt-why">
        <summary className="dt-why-summary">Vì sao vào lệnh · {info.method}</summary>
        <div className="dt-why-body">
          <p><span className="dt-why-tag">Phương pháp</span>{info.how}</p>
          <p><span className="dt-why-tag">Lý do vào lệnh</span>{info.reason}</p>
          <p><span className="dt-why-tag">Kế hoạch thoát</span>{info.exit}</p>
        </div>
      </details>

      <NoteBlock signal={signal} />

      <div className="dt-meta">
        Vào lệnh {formatTime(signal.detectedAt)} · Notional {signal.positionValue != null ? `~$${signal.positionValue.toFixed(0)}` : '—'}
      </div>
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

function StatsHeader({ stats }: { stats: SwingTradingStats }) {
  const totalPnlUsd = stats.totalPnlUsd;
  return (
    <div className="dt-stats">
      <StatCard label="Signals" value={stats.total} />
      <StatCard label="Đang mở" value={stats.active} modifier="dt-stat-value--accent" />
      <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} modifier={stats.winRate >= 50 ? 'dt-stat-value--pos' : 'dt-stat-value--neg'} />
      <StatCard label="Thắng / Thua" value={`${stats.wins} / ${stats.losses}`} />
      <StatCard
        label="Total P&L"
        value={`${totalPnlUsd >= 0 ? '+' : '-'}$${Math.abs(totalPnlUsd).toFixed(2)}`}
        modifier={totalPnlUsd >= 0 ? 'dt-stat-value--pos' : 'dt-stat-value--neg'}
      />
    </div>
  );
}

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'Tất cả', value: 'ALL' },
  { label: 'Đang mở', value: 'ACTIVE' },
  { label: 'Đã đóng', value: 'CLOSED' },
];

type NumField = { key: 'atrPeriod' | 'keyValue' | 'riskPerTrade' | 'leverage'; label: string; hint: string; step: number; min: number };
const NUM_FIELDS: NumField[] = [
  { key: 'riskPerTrade', label: 'Vốn mỗi lệnh (USDT)', hint: 'Notional cơ sở; nhân với đòn bẩy', step: 50, min: 1 },
  { key: 'leverage', label: 'Đòn bẩy (x)', hint: 'Hệ số notional khi giao dịch thật', step: 1, min: 1 },
  { key: 'atrPeriod', label: 'ATR period', hint: 'Chu kỳ Wilder ATR cho UTBot (mặc định 10)', step: 1, min: 1 },
  { key: 'keyValue', label: 'keyValue (ATR ×)', hint: 'Khoảng cách stop; cao = ít lệnh hơn. 0 = auto (tự chọn kv tối ưu theo coin + khung)', step: 0.5, min: 0 },
];

function SettingsPanel({
  settings,
  onSaved,
  onClose,
}: {
  settings: SwingTradingSettings;
  onSaved: (s: SwingTradingSettings) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SwingTradingSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await createApiClient().updateSwingTradingSettings(form);
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
        <label className="dt-setting">
          <span className="dt-setting-label">Symbol</span>
          <input
            className="dt-setting-input"
            type="text"
            value={form.symbol}
            onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))}
          />
          <span className="dt-setting-hint">Cặp futures Bitget (vd ETHUSDT)</span>
        </label>
        <label className="dt-setting">
          <span className="dt-setting-label">Timeframe</span>
          <select
            className="dt-setting-input"
            value={form.timeframe}
            onChange={(e) => setForm((p) => ({ ...p, timeframe: e.target.value }))}
          >
            <option value="4h">4h</option>
            <option value="1d">1d</option>
            <option value="1h">1h</option>
          </select>
          <span className="dt-setting-hint">Khung nến quyết định flip</span>
        </label>
        {NUM_FIELDS.map((f) => (
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
        <label className="dt-setting">
          <span className="dt-setting-label">Chế độ</span>
          <select
            className="dt-setting-input"
            value={form.mode}
            onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value as SwingTradingSettings['mode'] }))}
          >
            <option value="PAPER">PAPER (mô phỏng)</option>
            <option value="LIVE">LIVE (Bitget thật)</option>
          </select>
          <span className="dt-setting-hint">LIVE đặt lệnh thật khi đã nối tài khoản</span>
        </label>
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

export function SwingTradingFeed({ initialSignals, initialStats, initialSettings }: Props) {
  const [signals, setSignals] = useState<SwingTradingSignal[]>(initialSignals);
  const [stats, setStats] = useState<SwingTradingStats>(initialStats);
  const [settings, setSettings] = useState<SwingTradingSettings>(initialSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [loading, setLoading] = useState(false);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  const hasActive = signals.some((s) => s.status === 'ACTIVE');

  // Poll the live price every 5s — but only while an open position exists.
  useEffect(() => {
    if (!hasActive) {
      setLivePrice(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const { price } = await createApiClient().fetchSwingTradingPrice();
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
        api.fetchSwingTradingSignals({ status: status === 'ALL' ? undefined : status, limit: 50 }),
        api.fetchSwingTradingStats(),
      ]);
      setSignals(res.data);
      setStats(newStats);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 60s to pick up new flips and result updates
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
          <h1 className="dt-title">Swing Trading — {settings.symbol}</h1>
          <p className="dt-subtitle">
            UTBot Stop-and-Reverse · {settings.timeframe.toUpperCase()} · kv {settings.keyValue > 0 ? settings.keyValue : 'auto'} · vốn ${settings.riskPerTrade} × {settings.leverage}x · {settings.mode}
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
          Chưa có tín hiệu. Scanner kiểm tra UTBot flip sau mỗi nến {settings.timeframe.toUpperCase()} đóng.
        </div>
      ) : (
        <div className="dt-list">
          {signals.map((s) => <SignalCard key={s.id} signal={s} livePrice={livePrice} />)}
        </div>
      )}
    </div>
  );
}
