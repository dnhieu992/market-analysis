'use client';

import { useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { TrackingSetup, TrackingSetupInput } from '@web/shared/api/types';

import styles from './tracking.module.css';

const api = createApiClient();

export const STATUS_LABEL: Record<TrackingSetup['status'], string> = {
  PROPOSED: 'Đề xuất',
  WATCHING: 'Theo dõi',
  PENDING: 'Chờ khớp',
  OPEN: 'Đang mở',
  CLOSED: 'Đã đóng',
  CANCELLED: 'Đã huỷ',
  DISCARDED: 'Đã bỏ',
};

const CLOSE_LABEL: Record<string, string> = { TP: 'Chạm hết TP', SL: 'Dừng lỗ', BE: 'Hoà vốn', TRAIL: 'SL dời', MANUAL: 'Đóng tay' };

export function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return String(Number(n.toPrecision(6)));
  return String(Number(n.toPrecision(5)));
}

export function fmtR(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}R`;
}

export const rClass = (r: number | null | undefined) => (r == null ? '' : r > 0 ? styles.pos : r < 0 ? styles.neg : '');

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function StatusBadge({ status }: { status: TrackingSetup['status'] }) {
  return <span className={`${styles.badge} ${styles[`st${status}`] ?? ''}`}>{STATUS_LABEL[status]}</span>;
}

type Panel = null | 'move' | 'close' | 'discard' | 'cancel';

/** One swing setup with the actions its stage allows. Manual management on an open trade needs a reason. */
export function SetupCard({
  setup,
  onChange,
  onEdit,
  showSymbol = false,
}: {
  setup: TrackingSetup;
  onChange: (s: TrackingSetup) => void;
  onEdit?: (s: TrackingSetup) => void;
  showSymbol?: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [pct, setPct] = useState('100');
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState<number | null>(setup.rating);
  const [note, setNote] = useState(setup.reviewNote ?? '');

  const s = setup;
  const short = s.direction === 'SHORT';
  const done = s.status === 'CLOSED' || s.status === 'CANCELLED' || s.status === 'DISCARDED';
  // Planned R:R per target — chat cards carry the raw row, so fall back to computing it here.
  const rr = s.plannedRR ?? s.targets.map((t) => Math.round((Math.abs(t.price - s.entryPrice) / Math.abs(s.entryPrice - s.stopLoss)) * 100) / 100);

  async function run(path: string, body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.trackingAction<{ setup: TrackingSetup }>(`/${s.id}${path}`, body);
      onChange(res.setup);
      setPanel(null);
      setReason('');
      setPrice('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(false);
    }
  }

  const reasonOk = reason.trim().length > 0;

  return (
    <div className={`${styles.card} ${short ? styles.cardShort : ''} ${done ? styles.cardDone : ''}`}>
      <div className={styles.cardHead}>
        {showSymbol && <span className={styles.cardSymbol}>{s.symbol}</span>}
        <span className={short ? styles.short : styles.long}>{s.direction}</span>
        <span className={styles.badge}>{s.orderType}</span>
        <StatusBadge status={s.status} />
        {s.source === 'CLAUDE' ? <span className={styles.badge}>Claude</span> : <span className={styles.badge}>Tự nhập</span>}
        {s.manualIntervention && <span className={`${styles.badge} ${styles.stPENDING}`}>Can thiệp tay</span>}
        {s.setupType && <span className={styles.cardType}>{s.setupType}</span>}
        <span className={styles.spacer} />
        {s.status === 'OPEN' && <strong className={rClass(s.unrealizedR)}>{fmtR(s.unrealizedR)}</strong>}
        {s.status === 'CLOSED' && (
          <strong className={rClass(s.rMultiple)}>
            {fmtR(s.rMultiple)} · {CLOSE_LABEL[s.closeReason ?? ''] ?? s.closeReason}
          </strong>
        )}
      </div>

      <div className={styles.levels}>
        <Level label={s.fillPrice != null ? 'Khớp' : 'Entry'} value={fmtPx(s.fillPrice ?? s.entryPrice)} />
        <Level label={s.currentStop != null && s.currentStop !== s.stopLoss ? `SL (gốc ${fmtPx(s.stopLoss)})` : 'SL'} value={fmtPx(s.currentStop ?? s.stopLoss)} />
        {s.targets.map((t, i) => (
          <Level
            key={i}
            label={`TP${i + 1} · ${t.pct}%${Number.isFinite(rr[i]) ? ` · ${rr[i]}R` : ''}`}
            value={fmtPx(t.price)}
            hit={Boolean(t.hitAt)}
          />
        ))}
        {s.lastPrice != null && !done && <Level label="Giá" value={fmtPx(s.lastPrice)} />}
        {(s.mfeR != null || s.maeR != null) && <Level label="MFE / MAE" value={`${fmtR(s.mfeR)} / ${fmtR(s.maeR)}`} />}
      </div>

      {s.thesis && <p className={styles.thesis}>{s.thesis}</p>}
      {(s.triggerNote || s.invalidation) && (
        <div className={styles.meta}>
          {s.triggerNote && <div>⏱ Kích hoạt: {s.triggerNote}</div>}
          {s.invalidation && <div>✕ Huỷ khi: {s.invalidation}</div>}
        </div>
      )}
      <div className={styles.meta}>
        1R = ${s.riskUsd}
        {s.riskPct != null ? ` · SL cách ${s.riskPct}%` : ''}
        {s.confidence ? ` · tin cậy ${s.confidence}` : ''}
        {' · '}tạo {fmtDateTime(s.createdAt)}
        {s.filledAt ? ` · khớp ${fmtDateTime(s.filledAt)}` : ''}
        {s.closedAt ? ` · kết thúc ${fmtDateTime(s.closedAt)}` : ''}
      </div>

      {/* stage actions */}
      {!done && (
        <div className={styles.actions}>
          {s.status === 'PROPOSED' && (
            <button type="button" className={styles.btn} disabled={busy} onClick={() => void run('/watch')}>Theo dõi</button>
          )}
          {(s.status === 'PROPOSED' || s.status === 'WATCHING') && (
            <>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void run('/place')}>
                {s.orderType === 'MARKET' ? 'Vào lệnh ngay' : `Đặt lệnh ${s.orderType}`}
              </button>
              {onEdit && <button type="button" className={styles.btn} disabled={busy} onClick={() => onEdit(s)}>Sửa</button>}
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => setPanel(panel === 'discard' ? null : 'discard')}>Bỏ</button>
            </>
          )}
          {s.status === 'PENDING' && (
            <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>Huỷ lệnh</button>
          )}
          {s.status === 'OPEN' && (
            <>
              <button type="button" className={styles.btn} disabled={busy} onClick={() => setPanel(panel === 'move' ? null : 'move')}>Dời SL</button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => setPanel(panel === 'close' ? null : 'close')}>Đóng tay</button>
            </>
          )}
        </div>
      )}

      {(panel === 'discard' || panel === 'cancel') && (
        <div className={styles.inlineForm}>
          <input className={styles.input} placeholder="Lý do (tuỳ chọn)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => void run(panel === 'discard' ? '/discard' : '/cancel', { reason })}>
            Xác nhận
          </button>
        </div>
      )}
      {panel === 'move' && (
        <div className={styles.inlineForm}>
          <input className={`${styles.input} ${styles.num}`} inputMode="decimal" placeholder="SL mới" value={price} onChange={(e) => setPrice(e.target.value)} />
          <input className={styles.input} placeholder="Lý do (bắt buộc)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !reasonOk || !(Number(price) > 0)} onClick={() => void run('/move-stop', { price: Number(price), reason })}>
            Dời
          </button>
        </div>
      )}
      {panel === 'close' && (
        <div className={styles.inlineForm}>
          <select className={styles.select} value={pct} onChange={(e) => setPct(e.target.value)}>
            <option value="25">25%</option>
            <option value="50">50%</option>
            <option value="75">75%</option>
            <option value="100">Toàn bộ</option>
          </select>
          <input className={styles.input} placeholder="Lý do (bắt buộc)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy || !reasonOk} onClick={() => void run('/close', { pct: Number(pct), reason })}>
            Đóng @ giá thị trường
          </button>
        </div>
      )}

      {/* review */}
      {s.status === 'CLOSED' && (
        <>
          <div className={styles.inlineForm}>
            <span className={styles.hint}>Tự chấm:</span>
            <span className={styles.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`${styles.star} ${rating != null && n <= rating ? styles.starOn : ''}`}
                  onClick={() => setRating(rating === n ? null : n)}
                  aria-label={`${n} sao`}
                >
                  ★
                </button>
              ))}
            </span>
            <input className={styles.input} placeholder="Nhận xét của bạn" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              type="button"
              className={styles.btn}
              disabled={busy || (rating === s.rating && note === (s.reviewNote ?? ''))}
              onClick={() => void run('/review', { rating, note })}
            >
              Lưu
            </button>
          </div>
          <div className={styles.postMortem}>
            <div className={styles.row}>
              <strong>Claude rút kinh nghiệm</strong>
              <span className={styles.spacer} />
              <button type="button" className={styles.btn} disabled={busy} onClick={() => void run('/postmortem')}>
                {busy ? 'Đang viết…' : s.postMortem ? 'Viết lại' : 'Viết'}
              </button>
            </div>
            {s.postMortem ? <p className={styles.thesis}>{s.postMortem}</p> : <p className={styles.hint}>Chưa có — tự viết vài phút sau khi lệnh đóng.</p>}
          </div>
        </>
      )}

      {error && <div className={styles.error} style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function Level({ label, value, hit }: { label: string; value: string; hit?: boolean }) {
  return (
    <div className={styles.level}>
      <span className={styles.levelLabel}>{label}</span>
      <span className={`${styles.levelValue} ${hit ? styles.levelHit : ''}`}>{value}</span>
    </div>
  );
}

/** Manual setup (new) or edit of a plan that hasn't been placed. */
export function SetupFormModal({
  symbols,
  initial,
  defaultSymbol,
  onClose,
  onSaved,
}: {
  symbols: string[];
  initial?: TrackingSetup | null;
  defaultSymbol?: string | null;
  onClose: () => void;
  onSaved: (s: TrackingSetup) => void;
}) {
  const t = initial?.targets ?? [];
  const [symbol, setSymbol] = useState(initial?.symbol ?? defaultSymbol ?? symbols[0] ?? '');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>(initial?.direction ?? 'LONG');
  const [orderType, setOrderType] = useState<'LIMIT' | 'STOP' | 'MARKET'>(initial?.orderType ?? 'LIMIT');
  const [entry, setEntry] = useState(initial ? String(initial.entryPrice) : '');
  const [stop, setStop] = useState(initial ? String(initial.stopLoss) : '');
  const [tps, setTps] = useState<string[]>([0, 1, 2].map((i) => (t[i] ? String(t[i]!.price) : '')));
  const [pcts, setPcts] = useState<string[]>([0, 1, 2].map((i) => (t[i] ? String(t[i]!.pct) : '')));
  const [setupType, setSetupType] = useState(initial?.setupType ?? '');
  const [triggerNote, setTriggerNote] = useState(initial?.triggerNote ?? '');
  const [invalidation, setInvalidation] = useState(initial?.invalidation ?? '');
  const [thesis, setThesis] = useState(initial?.thesis ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(place: boolean) {
    const filled = tps.map((v, i) => ({ price: Number(v), pct: Number(pcts[i]) })).filter((x) => x.price > 0);
    if (!(Number(entry) > 0)) return setError('Nhập giá entry (MARKET: giá tham khảo, khớp ở giá thị trường).');
    if (!(Number(stop) > 0)) return setError('Nhập SL.');
    if (filled.length === 0) return setError('Cần ít nhất 1 TP.');
    const customPct = filled.some((x) => x.pct > 0);
    if (customPct && filled.reduce((a, x) => a + (x.pct || 0), 0) !== 100) return setError('Tổng % chốt các TP phải bằng 100 (hoặc để trống để dùng 50/30/20).');
    const input: TrackingSetupInput = {
      symbol,
      direction,
      orderType,
      entryPrice: Number(entry) || 0,
      stopLoss: Number(stop),
      targets: filled.map((x) => x.price),
      ...(customPct ? { targetPcts: filled.map((x) => x.pct) } : {}),
      setupType: setupType.trim() || undefined,
      triggerNote: triggerNote.trim() || undefined,
      invalidation: invalidation.trim() || undefined,
      thesis: thesis.trim() || undefined,
    };
    setBusy(true);
    setError(null);
    try {
      let res: { setup: TrackingSetup };
      if (initial) {
        res = await api.trackingAction(`/${initial.id}`, input, 'PUT');
        if (place) res = await api.trackingAction(`/${initial.id}/place`);
      } else {
        res = await api.createTrackingSetup({ ...input, place });
      }
      onSaved(res.setup);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  const setAt = (arr: string[], i: number, v: string) => arr.map((x, j) => (j === i ? v : x));

  return (
    <>
      <div className={styles.modalBackdrop} onClick={onClose} />
      <div className={styles.modal} role="dialog" aria-label="Setup swing">
        <div className={styles.row}>
          <strong>{initial ? `Sửa setup ${initial.symbol}` : 'Setup swing mới'}</strong>
          <span className={styles.spacer} />
          <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className={styles.formGrid}>
          <label>
            Coin
            <select className={styles.select} value={symbol} disabled={Boolean(initial) || Boolean(defaultSymbol)} onChange={(e) => setSymbol(e.target.value)}>
              {symbols.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label>
            Hướng
            <select className={styles.select} value={direction} onChange={(e) => setDirection(e.target.value as 'LONG' | 'SHORT')}>
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
          </label>
          <label>
            Loại lệnh
            <select className={styles.select} value={orderType} onChange={(e) => setOrderType(e.target.value as 'LIMIT' | 'STOP' | 'MARKET')}>
              <option value="LIMIT">LIMIT — chờ giá hồi về</option>
              <option value="STOP">STOP — chờ giá phá qua</option>
              <option value="MARKET">MARKET — vào ngay</option>
            </select>
          </label>
          <label>
            Entry {orderType === 'MARKET' && '(tham khảo)'}
            <input className={styles.input} inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} />
          </label>
          <label>
            Stop loss
            <input className={styles.input} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
          </label>
          <label>
            Loại setup (để thống kê)
            <input className={styles.input} placeholder="vd Pullback EMA34 D1" value={setupType} onChange={(e) => setSetupType(e.target.value)} />
          </label>
          {[0, 1, 2].map((i) => (
            <label key={i}>
              TP{i + 1} · % chốt
              <span className={styles.row} style={{ flexWrap: 'nowrap' }}>
                <input className={styles.input} style={{ flex: 1 }} inputMode="decimal" value={tps[i]} onChange={(e) => setTps(setAt(tps, i, e.target.value))} />
                <input className={styles.input} style={{ width: 56 }} inputMode="numeric" placeholder={['50', '30', '20'][i]} value={pcts[i]} onChange={(e) => setPcts(setAt(pcts, i, e.target.value))} />
              </span>
            </label>
          ))}
          <label className={styles.full}>
            Điều kiện kích hoạt
            <input className={styles.input} placeholder="vd nến 4H đóng trên 0.589" value={triggerNote} onChange={(e) => setTriggerNote(e.target.value)} />
          </label>
          <label className={styles.full}>
            Huỷ khi
            <input className={styles.input} value={invalidation} onChange={(e) => setInvalidation(e.target.value)} />
          </label>
          <label className={styles.full}>
            Luận điểm
            <textarea className={styles.textarea} value={thesis} onChange={(e) => setThesis(e.target.value)} />
          </label>
        </div>
        <p className={styles.hint}>Để trống % thì chốt 50/30/20. Chạm TP1 → SL về hoà vốn, chạm TP2 → SL lên TP1.</p>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions} style={{ justifyContent: 'flex-end' }}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="button" className={styles.btn} onClick={() => void save(false)} disabled={busy || !symbol}>{initial ? 'Lưu' : 'Lưu để theo dõi'}</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void save(true)} disabled={busy || !symbol}>
            {busy ? '…' : 'Lưu & đặt lệnh'}
          </button>
        </div>
      </div>
    </>
  );
}
