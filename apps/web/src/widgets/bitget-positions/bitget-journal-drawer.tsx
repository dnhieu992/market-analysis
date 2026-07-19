'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import type { BitgetJournalNote, BitgetPosition } from '@web/shared/api/types';

// Lazy-load the TipTap editor so its bundle only loads when a journal is opened.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

/**
 * Trade session key: notes are grouped per (symbol, side, open time), so closing
 * and re-opening the same symbol/side later starts a fresh log timeline. Kept in
 * sync with the API's CreateJournalDto.tradeKey.
 */
export function tradeKeyOf(p: Pick<BitgetPosition, 'symbol' | 'holdSide' | 'openedAt'>): string {
  return `${p.symbol}-${p.holdSide}-${p.openedAt ?? 'na'}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function fmtPct(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
}

function fmtPrice(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

type Props = {
  position: BitgetPosition;
  onClose: () => void;
};

export function BitgetJournalDrawer({ position, onClose }: Props) {
  const api = useMemo(() => createApiClient(), []);
  const tradeKey = tradeKeyOf(position);

  const [mounted, setMounted] = useState(false);
  const [notes, setNotes] = useState<BitgetJournalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'formatting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Always the latest position, so a save snapshots the live price at click time.
  const posRef = useRef(position);
  posRef.current = position;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .fetchBitgetJournal(tradeKey)
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
  }, [api, tradeKey]);

  // Close on Escape.
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

  function editNote(note: BitgetJournalNote) {
    setEditingId(note.id);
    setContent(note.content);
    setExistingImages(note.images);
    setPendingFiles([]);
    setWarning(null);
    setError(null);
  }

  async function save() {
    if (!content.trim() && pendingFiles.length === 0 && existingImages.length === 0) return;
    setError(null);
    setWarning(null);

    // Format the raw markdown via Claude (shared /journal/reformat endpoint).
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
        const urls = await api.uploadImages(pendingFiles, position.symbol, position.holdSide);
        images = [...existingImages, ...urls];
      }

      if (editingId) {
        const updated = await api.updateBitgetJournal(editingId, { content: finalContent, images });
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      } else {
        const p = posRef.current;
        const created = await api.addBitgetJournal({
          tradeKey,
          symbol: p.symbol,
          holdSide: p.holdSide,
          content: finalContent,
          images,
          snapshot: {
            markPrice: p.markPrice,
            entryPrice: p.entryPrice,
            roePct: p.roePct,
            unrealizedPnlUsd: p.unrealizedPnlUsd,
          },
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
      await api.deleteBitgetJournal(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (editingId === id) resetEditor();
    } catch {
      setError('Xoá thất bại. Thử lại sau.');
    }
  }

  if (!mounted) return null;

  const isLong = position.holdSide === 'long';

  return createPortal(
    <div className="bgj-overlay" onClick={onClose} role="dialog" aria-modal>
      <div className="bgj-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="bgj-head">
          <div>
            <h2 className="bgj-title">
              Nhật ký lệnh · <span className="bgj-symbol">{position.symbol}</span>{' '}
              <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
                {isLong ? 'LONG' : 'SHORT'}
              </span>
            </h2>
            <p className="bgj-sub">
              Giá vào {fmtPrice(position.entryPrice)} · Hiện tại {fmtPrice(position.markPrice)} ·{' '}
              <span className={position.roePct >= 0 ? 'bg-pnl--up' : 'bg-pnl--down'}>{fmtPct(position.roePct)}</span>
              {position.openedAt && ` · mở ${fmtTime(position.openedAt)}`}
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
              {notes.map((n) => (
                <li key={n.id} className={`bgj-note ${editingId === n.id ? 'bgj-note--editing' : ''}`}>
                  <div className="bgj-note-head">
                    <span className="bgj-note-time">{fmtTime(n.createdAt)}</span>
                    {n.snapshot && (
                      <span className="bgj-note-snap">
                        {fmtPrice(n.snapshot.markPrice)} ·{' '}
                        <span className={(n.snapshot.roePct ?? 0) >= 0 ? 'bg-pnl--up' : 'bg-pnl--down'}>
                          {fmtPct(n.snapshot.roePct)}
                        </span>
                      </span>
                    )}
                    <span className="bgj-note-actions">
                      <button className="bgj-link" onClick={() => editNote(n)} disabled={busy}>Sửa</button>
                      <button className="bgj-link bgj-link--danger" onClick={() => remove(n.id)} disabled={busy}>Xoá</button>
                    </span>
                  </div>
                  {n.content.trim() && (
                    <div
                      className="bgj-note-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(n.content) }}
                    />
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
              ))}
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
            placeholder="Bạn đang nghĩ gì về lệnh này? Kế hoạch, mốc giá theo dõi, lý do vào/giữ, cảm xúc…"
            minHeight={120}
          />

          <div className="bgj-thumbs bgj-thumbs--compose">
            {existingImages.map((url) => (
              <div key={url} className="bgj-thumb bgj-thumb--edit">
                <img src={url} alt="chart" />
                <button
                  className="bgj-thumb-x"
                  onClick={() => setExistingImages((prev) => prev.filter((u) => u !== url))}
                  title="Xoá ảnh"
                >
                  ×
                </button>
              </div>
            ))}
            {pendingPreviews.map((p, i) => (
              <div key={p.url} className="bgj-thumb bgj-thumb--edit">
                <img src={p.url} alt={p.name} />
                <button
                  className="bgj-thumb-x"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  title="Bỏ"
                >
                  ×
                </button>
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
