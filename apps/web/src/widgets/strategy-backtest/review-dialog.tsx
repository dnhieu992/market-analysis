'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import { ImageUpload, type ImageUploadValue } from '@web/shared/ui/image-upload/image-upload';
import type { StrategyBacktestBoard, StrategyBacktestSetup } from '@web/shared/api/types';

// Lazy-loaded like every other TipTap surface in the app: the editor bundle only
// arrives when a review is actually opened for editing.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

const apiClient = createApiClient();

/**
 * The post-mortem of one setup. Portalled to document.body — the setup card is a
 * `card`-style surface and a fixed overlay rendered inside one gets trapped by its
 * stacking context (same reason the invalid dialog portals).
 *
 * Opens straight in edit mode when there is nothing written yet, and in read mode
 * once there is, because re-reading an old verdict is the common case.
 */
export function ReviewDialog({
  setup,
  onSaved,
  onClose,
}: {
  setup: StrategyBacktestSetup;
  onSaved: (board: StrategyBacktestBoard) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(!setup.review?.trim());
  const [text, setText] = useState(setup.review ?? '');
  const [urls, setUrls] = useState<string[]>(setup.reviewImages);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !lightbox) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving, lightbox]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Upload first, exactly like the create form: a review that saved but lost its
      // charts is the worse outcome, so a failed upload aborts before anything is written.
      const uploaded = pendingFiles.length
        ? await apiClient.uploadImages(pendingFiles, setup.symbol)
        : [];
      const nextUrls = [...urls, ...uploaded];

      await apiClient.updateStrategyBacktestSetup(setup.id, {
        review: text,
        reviewImages: nextUrls,
      });
      onSaved(await apiClient.fetchStrategyBacktestBoard());
      setUrls(nextUrls);
      setPendingFiles([]);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được review');
    } finally {
      setSaving(false);
    }
  };

  const hasReview = Boolean(setup.review?.trim());

  return createPortal(
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div className="dialog sbt-review-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            Review — {setup.direction === 'LONG' ? '▲ Long' : '▼ Short'} {setup.symbol}
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng" disabled={saving}>
            ✕
          </button>
        </div>

        <div className="dialog-body sbt-review-body">
          <ResultStrip setup={setup} />

          {editing ? (
            <>
              <MarkdownEditor
                value={text}
                onChange={setText}
                placeholder="Vì sao lệnh này thắng/thua? Vào đúng chưa, TP/SL đặt ở đâu, lần sau sửa gì…"
                minHeight={260}
                autofocus
              />

              <div className="sbt-field">
                <label className="sbt-label">Ảnh review</label>
                <ImageUpload
                  existingUrls={urls}
                  onChange={(value: ImageUploadValue) => {
                    setUrls(value.existingUrls);
                    setPendingFiles(value.newFiles);
                  }}
                  uploading={saving}
                />
              </div>
            </>
          ) : (
            <>
              {hasReview ? (
                <div
                  className="sbt-review-render"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(setup.review ?? '') }}
                />
              ) : (
                <p className="sbt-review-empty">Chưa có review cho lệnh này.</p>
              )}

              {urls.length > 0 ? (
                <div className="sbt-images">
                  {urls.map((url) => (
                    <button
                      key={url}
                      type="button"
                      className="sbt-thumb"
                      onClick={() => setLightbox(url)}
                      aria-label="Xem ảnh review"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Chart review" />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {error ? <p className="sbt-error">{error}</p> : null}

          <div className="dialog-confirm-actions">
            {editing ? (
              <>
                <button
                  type="button"
                  className="sbt-btn"
                  disabled={saving}
                  onClick={() => {
                    // Cancelling an edit of an existing review drops back to reading it;
                    // cancelling the first-ever one just closes, there is nothing to read.
                    if (!hasReview) {
                      onClose();
                      return;
                    }
                    setText(setup.review ?? '');
                    setUrls(setup.reviewImages);
                    setPendingFiles([]);
                    setError(null);
                    setEditing(false);
                  }}
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  className="sbt-btn sbt-btn--primary"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? 'Đang lưu…' : 'Lưu review'}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="sbt-btn" onClick={onClose}>
                  Đóng
                </button>
                <button
                  type="button"
                  className="sbt-btn sbt-btn--primary"
                  onClick={() => setEditing(true)}
                >
                  Sửa review
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {lightbox ? (
        <div className="lightbox-backdrop" onClick={() => setLightbox(null)}>
          <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="Đóng">
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Chart review"
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/** The numbers the review is about, so the verdict is written next to the result. */
function ResultStrip({ setup }: { setup: StrategyBacktestSetup }) {
  const pct = setup.pnlPct ?? setup.unrealizedPct;
  const r = setup.rMultiple ?? setup.unrealizedR;
  const fmt = (v: number | null) =>
    v == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);

  const cells: [string, string][] = [
    ['Entry', fmt(setup.entryPrice)],
    ['SL', fmt(setup.stopLoss)],
    ['TP', fmt(setup.takeProfit)],
    ['Thoát', fmt(setup.exitPrice)],
    ['Kết quả', pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`],
    ['R', r == null ? '—' : `${r > 0 ? '+' : ''}${r.toFixed(2)}R`],
  ];

  return (
    <div className="sbt-review-strip">
      {cells.map(([label, value]) => (
        <div key={label} className="sbt-price">
          <span className="sbt-price-label">{label}</span>
          <span className="sbt-price-value">{value}</span>
        </div>
      ))}
    </div>
  );
}
