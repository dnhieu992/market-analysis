'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { renderMarkdown } from '@web/shared/lib/markdown';
import type { TradingJournalEntry } from '@web/shared/api/types';

import { formatDate } from './journal-format';

/**
 * Read-only view of one day's journal entry.
 *
 * Clicking a past entry used to load it straight into the editor, so simply
 * re-reading an old day put it one stray keystroke away from being rewritten.
 * Reading now happens here — rendered Markdown, tags and charts — and editing
 * takes a deliberate second click on `Sửa`.
 *
 * Portals to `document.body`: the journal cards would otherwise contain the
 * fixed backdrop and it would only cover the content column.
 */
export function JournalEntryDialog({
  entry,
  onEdit,
  onClose,
}: {
  entry: TradingJournalEntry;
  onEdit: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasContent = entry.content.trim().length > 0;

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--wide tj-view" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title tj-view-title">{formatDate(entry.date)}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="dialog-body tj-view-body">
          {hasContent ? (
            <div className="tj-view-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.content) }} />
          ) : (
            <p className="tj-muted">(nhật ký ngày này chưa có nội dung)</p>
          )}

          {entry.tags.length > 0 && (
            <div className="tj-item-tags">
              {entry.tags.map((t) => <span key={t} className="tj-chip tj-chip-sm">{t}</span>)}
            </div>
          )}

          {entry.images.length > 0 && (
            <div className="tj-thumbs">
              {entry.images.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="tj-thumb">
                  <img src={url} alt="chart" />
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="tj-view-actions">
          <button type="button" className="tj-btn" onClick={onClose}>Đóng</button>
          <button type="button" className="tj-btn tj-btn-primary" onClick={onEdit}>✏️ Sửa nhật ký này</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
