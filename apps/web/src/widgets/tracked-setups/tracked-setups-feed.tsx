'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import { formatPrice } from '@web/shared/lib/format';
import { estimateSetupPnl, formatPnlAmount, formatPnlPct } from '@web/shared/lib/setup-pnl';
import type { TrackedSetup } from '@web/shared/api/types';

// Lazy-load the TipTap editor so its bundle only loads when notes are opened.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

function PnlChip({ s }: { s: TrackedSetup }) {
  const pnl = estimateSetupPnl(s);
  if (!pnl) return <span className="ts-pnl ts-pnl--none">—</span>;
  const cls = pnl.pct >= 0 ? 'ts-pnl ts-pnl--up' : 'ts-pnl ts-pnl--down';
  const title = pnl.realized
    ? 'PnL ước tính trên vốn $1000 (đã chốt, gồm phí)'
    : 'PnL tạm tính trên vốn $1000 theo giá hiện tại';
  return (
    <span className={cls} title={title}>
      {formatPnlAmount(pnl)} <span className="ts-pnl-pct">{formatPnlPct(pnl)}</span>
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ khớp',
  ENTERED: 'Đã khớp',
  TP1_HIT: 'Chạm TP1',
  TP2_HIT: 'Chạm TP2',
  SL_HIT: 'Dính SL',
  INVALID: 'Không hợp lệ',
  EXPIRED: 'Hết hạn',
};

function statusClass(status: string): string {
  if (status === 'TP1_HIT' || status === 'TP2_HIT') return 'dp-setup-status dp-setup-status--win';
  if (status === 'SL_HIT') return 'dp-setup-status dp-setup-status--loss';
  if (status === 'ENTERED') return 'dp-setup-status dp-setup-status--active';
  if (status === 'INVALID' || status === 'EXPIRED') return 'dp-setup-status dp-setup-status--dead';
  return 'dp-setup-status dp-setup-status--pending';
}

type Bucket = 'all' | 'open' | 'win' | 'loss' | 'dead';

const BUCKETS: { key: Bucket; label: string; match: (s: string) => boolean }[] = [
  { key: 'all', label: 'Tất cả', match: () => true },
  { key: 'open', label: 'Đang mở', match: (s) => s === 'PENDING' || s === 'ENTERED' },
  { key: 'win', label: 'Thắng', match: (s) => s === 'TP1_HIT' || s === 'TP2_HIT' },
  { key: 'loss', label: 'Thua', match: (s) => s === 'SL_HIT' },
  { key: 'dead', label: 'Hết hạn/Huỷ', match: (s) => s === 'INVALID' || s === 'EXPIRED' },
];

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
}

function PriceCell({ label, value, modifier }: { label: string; value: string; modifier?: string }) {
  return (
    <div className="ts-price">
      <span className="ts-price-label">{label}</span>
      <span className={`ts-price-value${modifier ? ` ${modifier}` : ''}`}>{value}</span>
    </div>
  );
}

/**
 * Copy `text` to the clipboard. The async Clipboard API only works in secure
 * contexts (HTTPS or localhost); the dashboard is served over plain HTTP, so we
 * fall back to a hidden-textarea + execCommand('copy') there.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyText(id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      className={`ts-copy-id${copied ? ' is-copied' : ''}`}
      onClick={() => void copy()}
      title={copied ? 'Đã copy ID' : 'Copy ID lệnh'}
      aria-label="Copy ID lệnh"
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

function DirBadge({ direction }: { direction: string }) {
  const cls =
    direction === 'long' ? 'dp-dir-badge dp-dir-badge--long' :
    direction === 'short' ? 'dp-dir-badge dp-dir-badge--short' :
    'dp-dir-badge dp-dir-badge--none';
  const label = direction === 'long' ? '▲ Long' : direction === 'short' ? '▼ Short' : '—';
  return <span className={cls}>{label}</span>;
}

function NotesSection({ s }: { s: TrackedSetup }) {
  const [notes, setNotes] = useState<string>(s.notes ?? '');
  const [draft, setDraft] = useState<string>(s.notes ?? '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(notes);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(notes);
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await createApiClient().updateTrackedSetupNotes(s.id, draft);
      const saved = updated.notes ?? '';
      setNotes(saved);
      setDraft(saved);
      setEditing(false);
    } catch {
      setError('Lưu ghi chú thất bại. Thử lại.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="ts-notes ts-notes--editing">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          minHeight={160}
          placeholder="Ghi chú cho lệnh này…"
        />
        {error && <p className="ts-notes-error">{error}</p>}
        <div className="ts-notes-actions">
          <button className="ts-notes-btn ts-notes-btn--ghost" onClick={cancel} disabled={saving}>
            Huỷ
          </button>
          <button className="ts-notes-btn" onClick={() => void save()} disabled={saving || draft === notes}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ts-notes">
      {notes ? (
        <>
          <div className="ts-notes-view">
            <MarkdownEditor value={notes} onChange={() => {}} editable={false} hideToolbar minHeight={0} />
          </div>
          <button className="ts-notes-btn ts-notes-btn--link" onClick={startEdit}>
            ✎ Sửa ghi chú
          </button>
        </>
      ) : (
        <button className="ts-notes-btn ts-notes-btn--link" onClick={startEdit}>
          + Thêm ghi chú
        </button>
      )}
    </div>
  );
}

function SetupRow({ s }: { s: TrackedSetup }) {
  const planDate = new Date(s.planDate).toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
  return (
    <article className="ts-row">
      <div className="ts-row-head">
        <span className="ts-symbol">{s.symbol}</span>
        <CopyIdButton id={s.id} />
        <DirBadge direction={s.direction} />
        <span className={statusClass(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</span>
        <span className="ts-slot">{s.slot === 'secondary' ? 'Phụ' : 'Chính'}</span>
        <PnlChip s={s} />
      </div>

      <div className="ts-prices">
        <PriceCell
          label="Entry"
          value={`${formatPrice(s.entryLow)}${s.entryHigh !== s.entryLow ? `–${formatPrice(s.entryHigh)}` : ''}`}
        />
        <PriceCell label="SL" value={formatPrice(s.stopLoss)} modifier="ts-price-value--sl" />
        {s.takeProfit1 != null && <PriceCell label="TP1" value={formatPrice(s.takeProfit1)} modifier="ts-price-value--tp" />}
        {s.takeProfit2 != null && <PriceCell label="TP2" value={formatPrice(s.takeProfit2)} modifier="ts-price-value--tp" />}
        {s.lastPrice != null && <PriceCell label="Giá hiện tại" value={formatPrice(s.lastPrice)} />}
      </div>

      <div className="ts-meta">
        <span>Lên KH: {planDate}</span>
        {s.enteredAt && <span>Khớp: {fmtDate(s.enteredAt)}</span>}
        {s.tp1HitAt && <span>TP1: {fmtDate(s.tp1HitAt)}</span>}
        {s.tp2HitAt && <span>TP2: {fmtDate(s.tp2HitAt)}</span>}
        {s.slHitAt && <span>SL: {fmtDate(s.slHitAt)}</span>}
        {s.closedAt && !s.slHitAt && !s.tp2HitAt && <span>Đóng: {fmtDate(s.closedAt)}</span>}
      </div>

      {s.invalidatedReason && <p className="ts-reason">{s.invalidatedReason}</p>}

      <NotesSection s={s} />
    </article>
  );
}

type Stats = {
  wins: number;
  losses: number;
  decided: number;
  winRate: number;
  realizedPnl: number;
};

function StatsBar({ stats }: { stats: Stats }) {
  const { wins, losses, decided, winRate, realizedPnl } = stats;
  const rateCls =
    decided === 0 ? 'ts-stat-value' : winRate >= 50 ? 'ts-stat-value ts-stat-value--up' : 'ts-stat-value ts-stat-value--down';
  const pnlCls = realizedPnl >= 0 ? 'ts-stat-value ts-stat-value--up' : 'ts-stat-value ts-stat-value--down';
  const pnlSign = realizedPnl >= 0 ? '+' : '-';
  return (
    <div className="ts-stats">
      <div className="ts-stat">
        <span className="ts-stat-label">Tỉ lệ thắng</span>
        <span className={rateCls}>{decided === 0 ? '—' : `${winRate.toFixed(0)}%`}</span>
        <span className="ts-stat-sub">{decided === 0 ? 'chưa có lệnh chốt' : `${wins}/${decided} lệnh`}</span>
      </div>
      <div className="ts-stat">
        <span className="ts-stat-label">Thắng</span>
        <span className="ts-stat-value ts-stat-value--up">{wins}</span>
      </div>
      <div className="ts-stat">
        <span className="ts-stat-label">Thua</span>
        <span className="ts-stat-value ts-stat-value--down">{losses}</span>
      </div>
      <div className="ts-stat">
        <span className="ts-stat-label">PnL đã chốt</span>
        <span className={pnlCls}>{`${pnlSign}$${Math.abs(realizedPnl).toFixed(2)}`}</span>
        <span className="ts-stat-sub">vốn $1000/lệnh</span>
      </div>
    </div>
  );
}

type Props = Readonly<{ setups: TrackedSetup[] }>;

export function TrackedSetupsFeed({ setups }: Props) {
  const [bucket, setBucket] = useState<Bucket>('all');

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { all: 0, open: 0, win: 0, loss: 0, dead: 0 };
    for (const s of setups) {
      for (const b of BUCKETS) if (b.match(s.status)) c[b.key] += 1;
    }
    return c;
  }, [setups]);

  const stats = useMemo<Stats>(() => {
    let wins = 0;
    let losses = 0;
    let realizedPnl = 0;
    for (const s of setups) {
      if (s.status === 'TP1_HIT' || s.status === 'TP2_HIT') wins += 1;
      else if (s.status === 'SL_HIT') losses += 1;
      const pnl = estimateSetupPnl(s);
      if (pnl?.realized) realizedPnl += pnl.amount;
    }
    const decided = wins + losses;
    return { wins, losses, decided, winRate: decided === 0 ? 0 : (wins / decided) * 100, realizedPnl };
  }, [setups]);

  const filtered = useMemo(() => {
    const match = BUCKETS.find((b) => b.key === bucket)?.match ?? (() => true);
    return setups.filter((s) => match(s.status));
  }, [setups, bucket]);

  return (
    <main className="dashboard-shell ts-shell">
      <header className="ts-header">
        <h1 className="ts-title">Lệnh theo dõi</h1>
        <p className="ts-subtitle">Các setup trích từ Daily Plan, tự cập nhật mỗi giờ.</p>
      </header>

      <StatsBar stats={stats} />

      <div className="ts-filters">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            className={`ts-filter${bucket === b.key ? ' is-active' : ''}`}
            onClick={() => setBucket(b.key)}
          >
            {b.label} <span className="ts-filter-count">{counts[b.key]}</span>
          </button>
        ))}
      </div>

      <section className="ts-list">
        {filtered.length === 0 ? (
          <p className="daily-plan-empty">Chưa có lệnh nào.</p>
        ) : (
          filtered.map((s) => <SetupRow key={s.id} s={s} />)
        )}
      </section>
    </main>
  );
}
