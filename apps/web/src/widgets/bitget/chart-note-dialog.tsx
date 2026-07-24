'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small modal shown before saving a chart: lets the trader attach an optional
 * free-text note (may be left blank). Submits the note back to the caller, which
 * performs the actual save. Portals to body so it stacks over the chart dialog.
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  return createPortal(
    <div className="dialog-backdrop" onClick={() => !saving && onCancel()}>
      <div className="dialog bg-note-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Thêm ghi chú cho chart</span>
          <button className="dialog-close" onClick={onCancel} aria-label="Đóng" disabled={saving}>
            ✕
          </button>
        </div>
        <div className="dialog-body bg-note-body">
          <textarea
            className="bg-note-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú (có thể để trống)…"
            rows={4}
            maxLength={2000}
            autoFocus
          />
          {error && <div className="bg-alert bg-alert--error">{error}</div>}
          <div className="bg-note-actions">
            <button type="button" className="bg-setup-btn" onClick={onCancel} disabled={saving}>
              Huỷ
            </button>
            <button
              type="button"
              className="bg-open-btn"
              onClick={() => onSubmit(note)}
              disabled={saving}
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
