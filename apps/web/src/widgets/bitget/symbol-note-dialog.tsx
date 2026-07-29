'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { renderMarkdown } from '@web/shared/lib/markdown';

// Lazy-load the shared TipTap editor so its bundle only loads when the dialog
// opens (same pattern as the chart-note dialog and the trade-journal drawer).
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

/** Plain-text preview of a Markdown note, for the table cell. */
export function notePreview(note: string, max = 60): string {
  const flat = note
    .replace(/[#*_`>[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Per-coin assessment editor for the Setup tab: the trader's running view on
 * one coin, in Markdown. Saving an empty note clears it. Portals to body so it
 * stacks over the table like the other Setup dialogs.
 */
export function SymbolNoteDialog({
  symbol,
  initialNote,
  updatedAt,
  saving = false,
  error = null,
  onSave,
  onClose,
}: {
  symbol: string;
  initialNote: string;
  updatedAt: string | null;
  saving?: boolean;
  error?: string | null;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(initialNote);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const dirty = note.trim() !== initialNote.trim();

  return createPortal(
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div className="dialog bg-note-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Đánh giá {symbol}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng" disabled={saving}>
            ✕
          </button>
        </div>
        <div className="dialog-body bg-note-body">
          <div className="bg-note-toolbar">
            <span className="bg-note-meta">
              {updatedAt
                ? `Cập nhật ${new Date(updatedAt).toLocaleString('vi-VN')}`
                : 'Chưa có đánh giá'}
            </span>
            <button
              type="button"
              className="bg-note-ai-btn"
              onClick={() => setPreview((p) => !p)}
              disabled={!note.trim()}
              title="Xem bản render Markdown"
            >
              {preview ? '✎ Soạn thảo' : '👁 Xem trước'}
            </button>
          </div>

          {preview ? (
            <div
              className="bg-gallery-note bg-note-preview"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(note) }}
            />
          ) : (
            <MarkdownEditor
              value={note}
              onChange={setNote}
              placeholder="Đánh giá coin này… (hỗ trợ Markdown) — để trống rồi Lưu sẽ xoá đánh giá"
              minHeight={220}
              autofocus
            />
          )}

          {error && <div className="bg-alert bg-alert--error">{error}</div>}

          <div className="bg-note-actions">
            <button type="button" className="bg-setup-btn" onClick={onClose} disabled={saving}>
              Đóng
            </button>
            <button
              type="button"
              className="bg-open-btn"
              onClick={() => onSave(note)}
              disabled={saving || !dirty}
            >
              {saving ? 'Đang lưu…' : '💾 Lưu đánh giá'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
