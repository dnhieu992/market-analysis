'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { EditStrategyForm } from '@web/features/edit-strategy/edit-strategy-form';
import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import type { TradingStrategy } from '@web/shared/api/types';

type StrategyDetailPanelProps = Readonly<{
  strategy: TradingStrategy;
}>;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function StrategyDetailPanel({ strategy }: StrategyDetailPanelProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleConfirmDelete() {
    setDeleteError(null);
    try {
      await createApiClient().deleteTradingStrategy(strategy.id);
      setDeleteOpen(false);
      startTransition(() => {
        router.push('/strategy');
        router.refresh();
      });
    } catch {
      setDeleteError('Delete failed. Please try again.');
    }
  }

  const updatedDiffers = strategy.updatedAt && strategy.updatedAt !== strategy.createdAt;

  return (
    <>
      <div className="strat-detail">
        {/* Header */}
        <header className="strat-detail-head">
          <div className="strat-detail-head-main">
            <h2 className="strat-detail-name">{strategy.name}</h2>
            <div className="strat-detail-meta">
              <span className="strat-ver-badge">v{strategy.version}</span>
              <span className="strat-detail-date">Tạo {fmtDate(strategy.createdAt)}</span>
              {updatedDiffers && (
                <span className="strat-detail-date">· Cập nhật {fmtDate(strategy.updatedAt)}</span>
              )}
            </div>
          </div>
          <div className="strat-detail-head-actions">
            <button className="btn btn--secondary btn--sm" onClick={() => setEditOpen(true)}>
              ✎ Sửa
            </button>
            <button className="btn btn--danger btn--sm" onClick={() => setDeleteOpen(true)}>
              Xoá
            </button>
          </div>
        </header>

        {/* Backtest / description */}
        <section className="strat-section">
          <div className="strat-section-head">
            <h3 className="strat-section-title">📊 Backtest &amp; mô tả</h3>
          </div>
          <div
            className="strat-detail-content strat-detail-content--md"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(strategy.content) }}
          />
        </section>

        {/* Personal note */}
        <StrategyNoteSection strategy={strategy} />
      </div>

      {editOpen && (
        <div className="dialog-backdrop" onClick={() => setEditOpen(false)}>
          <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Edit Strategy — {strategy.name}</span>
              <button className="dialog-close" onClick={() => setEditOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <EditStrategyForm
                strategy={strategy}
                onSubmitted={() => {
                  setEditOpen(false);
                  router.refresh();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="dialog-backdrop" onClick={() => setDeleteOpen(false)}>
          <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Delete Strategy</span>
              <button className="dialog-close" onClick={() => setDeleteOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-confirm-text">
                Are you sure you want to delete <strong>{strategy.name}</strong>? This action cannot be undone.
              </p>
              {deleteError ? <p className="trade-form-error">{deleteError}</p> : null}
              <div className="dialog-confirm-actions">
                <button className="btn btn--secondary" onClick={() => setDeleteOpen(false)}>Cancel</button>
                <button className="btn btn--danger" onClick={handleConfirmDelete} disabled={isPending}>
                  {isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Editable, persisted personal note — stored on `TradingStrategy.note`, separate from `content`. */
function StrategyNoteSection({ strategy }: { strategy: TradingStrategy }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(strategy.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasNote = Boolean(strategy.note && strategy.note.trim());

  function startEdit() {
    setDraft(strategy.note ?? '');
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const value = draft.trim();
      await createApiClient().updateTradingStrategy(strategy.id, { note: value === '' ? null : value });
      setEditing(false);
      router.refresh();
    } catch {
      setError('Lưu ghi chú thất bại. Thử lại sau.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="strat-section strat-note">
      <div className="strat-section-head">
        <h3 className="strat-section-title">📝 Ghi chú của tôi</h3>
        {!editing && (
          <button className="btn btn--ghost btn--sm" onClick={startEdit}>
            {hasNote ? '✎ Sửa ghi chú' : '+ Thêm ghi chú'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="strat-note-editor">
          <textarea
            className="strat-note-textarea"
            rows={6}
            value={draft}
            placeholder="Nhận định riêng của bạn về chiến lược này… (hỗ trợ markdown: **đậm**, bảng, - danh sách)"
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          {error && <p className="trade-form-error">{error}</p>}
          <div className="strat-note-actions">
            <button className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
            <button className="btn btn--secondary btn--sm" onClick={() => setEditing(false)} disabled={saving}>
              Huỷ
            </button>
          </div>
        </div>
      ) : hasNote ? (
        <div
          className="strat-detail-content--md strat-note-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(strategy.note ?? '') }}
        />
      ) : (
        <p className="strat-note-empty">
          Chưa có ghi chú. Bấm <strong>“+ Thêm ghi chú”</strong> để lưu nhận định riêng của bạn.
        </p>
      )}
    </section>
  );
}
