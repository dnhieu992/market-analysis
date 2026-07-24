'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';

// Lazy-load the shared TipTap editor so its bundle only loads when the note
// dialog opens (same pattern as the trade-journal drawer).
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

/**
 * Read-only render of a saved chart note (Markdown → HTML via the shared
 * renderer). Shows a muted placeholder when there is no note.
 */
export function ChartNoteView({ note }: { note: string | null }) {
  if (!note?.trim()) {
    return <p className="bg-gallery-note bg-gallery-note--empty">Không có ghi chú</p>;
  }
  return (
    <div className="bg-gallery-note" dangerouslySetInnerHTML={{ __html: renderMarkdown(note) }} />
  );
}

/**
 * Small modal shown before saving a chart: lets the trader attach an optional
 * Markdown note (may be left blank) via the shared MarkdownEditor, and reformat
 * the draft into clean Markdown with the LLM. Submits the note back to the
 * caller, which performs the actual save. Portals to body so it stacks over the
 * chart dialog.
 */

export function ChartNoteDialog({
  initialNote = '',
  saving = false,
  error = null,
  onSubmit,
  onCancel,
}: {
  initialNote?: string;
  saving?: boolean;
  error?: string | null;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(initialNote);
  const [formatting, setFormatting] = useState(false);
  const [formatErr, setFormatErr] = useState<string | null>(null);
  const clientRef = useRef(createApiClient());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && !formatting && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving, formatting]);

  async function reformat() {
    const draft = note.trim();
    if (!draft) return;
    setFormatting(true);
    setFormatErr(null);
    try {
      const formatted = await clientRef.current.reformatChartNote(draft);
      if (formatted) setNote(formatted);
    } catch (err) {
      setFormatErr(err instanceof Error ? err.message : 'Định dạng lại thất bại.');
    } finally {
      setFormatting(false);
    }
  }

  const busy = saving || formatting;

  return createPortal(
    <div className="dialog-backdrop" onClick={() => !busy && onCancel()}>
      <div className="dialog bg-note-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Thêm ghi chú cho chart</span>
          <button className="dialog-close" onClick={onCancel} aria-label="Đóng" disabled={busy}>
            ✕
          </button>
        </div>
        <div className="dialog-body bg-note-body">
          <div className="bg-note-toolbar">
            <button
              type="button"
              className="bg-note-ai-btn"
              onClick={() => void reformat()}
              disabled={busy || !note.trim()}
              title="Dùng AI định dạng lại ghi chú thành Markdown gọn gàng"
            >
              {formatting ? 'Đang định dạng…' : '✨ Định dạng bằng AI'}
            </button>
          </div>
          <MarkdownEditor
            value={note}
            onChange={setNote}
            placeholder="Ghi chú (có thể để trống)… hỗ trợ Markdown"
            minHeight={160}
            autofocus
          />
          {(formatErr || error) && (
            <div className="bg-alert bg-alert--error">{formatErr ?? error}</div>
          )}
          <div className="bg-note-actions">
            <button type="button" className="bg-setup-btn" onClick={onCancel} disabled={busy}>
              Huỷ
            </button>
            <button
              type="button"
              className="bg-open-btn"
              onClick={() => onSubmit(note)}
              disabled={busy}
            >
              {saving ? 'Đang lưu…' : '💾 Lưu chart'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
