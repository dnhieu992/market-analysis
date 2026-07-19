'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import type { OrderJournalNote } from '@web/shared/api/types';

// Lazy-load the TipTap editor so its bundle only loads when a journal is opened.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

/** What the drawer logs against — a /trades order, open or closed. */
export type OrderJournalTarget = {
  orderId: string;
  symbol: string;
  side: 'long' | 'short';
  status: 'open' | 'closed';
  entryPrice?: number;
  /** Live price (open) or close price (closed) — header + save snapshot. */
  price?: number;
  pnl?: number;
  openedAt?: string | null;
  closedAt?: string | null;
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function fmtPrice(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtUsd(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Props = {
  target: OrderJournalTarget;
  onClose: () => void;
};

export function OrderJournalDrawer({ target, onClose }: Props) {
  const api = useMemo(() => createApiClient(), []);
  const { orderId, symbol, side, status } = target;

  const [mounted, setMounted] = useState(false);
  const [notes, setNotes] = useState<OrderJournalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'formatting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Always the latest target, so a save snapshots the live price at click time.
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .fetchOrderJournal(orderId)
      .then((rows) => {
        if (alive) setNotes(rows);
      })
      .catch(() => {
        if (alive) setError('Không tải được nhật ký của lệnh này.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, orderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pendingPreviews = useMemo(
    () => pendingFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [pendingFiles],
  );

  const busy = phase !== 'idle';

  function resetEditor() {
    setContent('');
    setPendingFiles([]);
    setExistingImages([]);
    setEditingId(null);
    setWarning(null);
  }

  function onFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  function editNote(note: OrderJournalNote) {
    setEditingId(note.id);
    setContent(note.content);
    setExistingImages(note.images);
    setPendingFiles([]);
    setWarning(null);
    setError(null);
  }

  /** Price/PnL snapshot to stamp on a new manual note, from the freshest data. */
  function snapshotNow() {
    const t = targetRef.current;
    return { price: t.price, entryPrice: t.entryPrice, pnlUsd: t.pnl };
  }

  async function save() {
    if (!content.trim() && pendingFiles.length === 0 && existingImages.length === 0) return;
    setError(null);
    setWarning(null);

    let finalContent = content;
    if (content.trim()) {
      setPhase('formatting');
      try {
        const formatted = await api.reformatJournal(content);
        if (formatted.trim()) finalContent = formatted;
      } catch {
        setWarning('Không format lại được (Claude lỗi) — đã lưu nguyên văn.');
      }
    }

    setPhase('saving');
    try {
      let images = existingImages;
      if (pendingFiles.length) {
        const urls = await api.uploadImages(pendingFiles, symbol, side);
        images = [...existingImages, ...urls];
      }

      if (editingId) {
        const updated = await api.updateOrderJournal(editingId, { content: finalContent, images });
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      } else {
        const created = await api.addOrderJournal({
          orderId,
          content: finalContent,
          images,
          snapshot: snapshotNow(),
        });
        setNotes((prev) => [...prev, created]);
      }
      resetEditor();
    } catch {
      setError('Lưu ghi chú thất bại. Thử lại sau.');
    } finally {
      setPhase('idle');
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Xoá ghi chú này?')) return;
    try {
      await api.deleteOrderJournal(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (editingId === id) resetEditor();
    } catch {
      setError('Xoá thất bại. Thử lại sau.');
    }
  }

  if (!mounted) return null;

  const isLong = side === 'long';
  const closed = status === 'closed';

  return createPortal(
    <div className="bgj-overlay" onClick={onClose} role="dialog" aria-modal>
      <div className="bgj-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="bgj-head">
          <div>
            <h2 className="bgj-title">
              Nhật ký lệnh · <span className="bgj-symbol">{symbol}</span>{' '}
              <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
                {isLong ? 'LONG' : 'SHORT'}
              </span>
              {closed && <span className="bgj-status-chip">đã đóng</span>}
            </h2>
            <p className="bgj-sub">
              Giá vào {fmtPrice(target.entryPrice)} ·{' '}
              {closed ? (
                <>
                  Giá đóng {fmtPrice(target.price)} · PnL{' '}
                  <span className={(target.pnl ?? 0) >= 0 ? 'bg-pnl--up' : 'bg-pnl--down'}>
                    {fmtUsd(target.pnl)}
                  </span>
                  {target.closedAt && ` · đóng ${fmtTime(target.closedAt)}`}
                </>
              ) : (
                <>
                  Hiện tại {fmtPrice(target.price)}
                  {target.pnl != null && (
                    <>
                      {' · '}
                      <span className={target.pnl >= 0 ? 'bg-pnl--up' : 'bg-pnl--down'}>{fmtUsd(target.pnl)}</span>
                    </>
                  )}
                  {target.openedAt && ` · mở ${fmtTime(target.openedAt)}`}
                </>
              )}
            </p>
          </div>
          <button className="bgj-close" onClick={onClose} aria-label="Đóng">&#x2715;</button>
        </header>

        {error && <div className="bg-alert bg-alert--error">{error}</div>}
        {warning && <div className="bg-alert">{warning}</div>}

        {/* Timeline */}
        <div className="bgj-timeline">
          {loading ? (
            <p className="bgj-muted">Đang tải…</p>
          ) : notes.length === 0 ? (
            <p className="bgj-muted">Chưa có ghi chú nào. Viết ghi chú đầu tiên bên dưới để bắt đầu theo dõi lệnh này.</p>
          ) : (
            <ul className="bgj-notes">
              {notes.map((n) => {
                const system = n.kind === 'system';
                return (
                  <li
                    key={n.id}
                    className={`bgj-note ${system ? 'bgj-note--system' : ''} ${editingId === n.id ? 'bgj-note--editing' : ''}`}
                  >
                    <div className="bgj-note-head">
                      <span className="bgj-note-time">{fmtTime(n.createdAt)}</span>
                      {n.snapshot && !system && (
                        <span className="bgj-note-snap">{fmtPrice(n.snapshot.price)}</span>
                      )}
                      {!system && (
                        <span className="bgj-note-actions">
                          <button className="bgj-link" onClick={() => editNote(n)} disabled={busy}>Sửa</button>
                          <button className="bgj-link bgj-link--danger" onClick={() => remove(n.id)} disabled={busy}>Xoá</button>
                        </span>
                      )}
                    </div>
                    {n.content.trim() && (
                      <div className="bgj-note-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.content) }} />
                    )}
                    {n.images.length > 0 && (
                      <div className="bgj-thumbs">
                        {n.images.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer" className="bgj-thumb">
                            <img src={url} alt="chart" />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Composer */}
        <div className="bgj-composer">
          <div className="bgj-composer-head">
            <span className="bgj-label">{editingId ? 'Sửa ghi chú' : 'Ghi chú mới'}</span>
            <span className="bgj-hint">✨ Claude tự format lại khi lưu</span>
          </div>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            placeholder={
              closed
                ? 'Nhìn lại lệnh này: rút ra được gì, lẽ ra nên làm khác chỗ nào…'
                : 'Bạn đang nghĩ gì về lệnh này? Kế hoạch, mốc giá theo dõi, lý do vào/giữ, cảm xúc…'
            }
            minHeight={120}
          />

          <div className="bgj-thumbs bgj-thumbs--compose">
            {existingImages.map((url) => (
              <div key={url} className="bgj-thumb bgj-thumb--edit">
                <img src={url} alt="chart" />
                <button className="bgj-thumb-x" onClick={() => setExistingImages((prev) => prev.filter((u) => u !== url))} title="Xoá ảnh">×</button>
              </div>
            ))}
            {pendingPreviews.map((p, i) => (
              <div key={p.url} className="bgj-thumb bgj-thumb--edit">
                <img src={p.url} alt={p.name} />
                <button className="bgj-thumb-x" onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))} title="Bỏ">×</button>
              </div>
            ))}
            <label className="bgj-upload">
              + Ảnh
              <input type="file" accept="image/*" multiple hidden onChange={onFilesPicked} />
            </label>
          </div>

          <div className="bgj-composer-actions">
            <button className="bgj-btn bgj-btn--primary" onClick={save} disabled={busy}>
              {phase === 'formatting' ? '✨ Đang format…' : phase === 'saving' ? 'Đang lưu…' : editingId ? 'Cập nhật' : 'Lưu ghi chú'}
            </button>
            {editingId && (
              <button className="bgj-btn bgj-btn--ghost" onClick={resetEditor} disabled={busy}>
                Huỷ sửa
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
