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

type Tab = 'backtest' | 'note';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function StrategyDetailPanel({ strategy }: StrategyDetailPanelProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('backtest');
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

  const hasNote = Boolean(strategy.note && strategy.note.trim());
  const updatedDiffers = strategy.updatedAt && strategy.updatedAt !== strategy.createdAt;

  return (
    <>
      <div className="strat-detail">
        {/* Sticky header */}
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

        {/* Tabs */}
        <div className="strat-tabs" role="tablist" aria-label="Nội dung chiến lược">
          <button
            role="tab"
            aria-selected={tab === 'backtest'}
            className={`strat-tab${tab === 'backtest' ? ' strat-tab--active' : ''}`}
            onClick={() => setTab('backtest')}
          >
            📊 Backtest &amp; mô tả
          </button>
          <button
            role="tab"
            aria-selected={tab === 'note'}
            className={`strat-tab${tab === 'note' ? ' strat-tab--active' : ''}`}
            onClick={() => setTab('note')}
          >
            📝 Ghi chú của tôi
            {hasNote && <span className="strat-tab-dot" aria-label="có ghi chú" />}
          </button>
        </div>

        {/* Panel */}
        <div className="strat-tab-panel">
          {tab === 'backtest' ? (
            <div
              className="strat-detail-content strat-detail-content--md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(strategy.content) }}
            />
          ) : (
            <StrategyNoteSection strategy={strategy} />
          )}
        </div>
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
  const hasNote = Boolean(strategy.note && strategy.note.trim());
  // Auto-open the editor when there is no note yet, so the tab is immediately actionable.
  const [editing, setEditing] = useState(!hasNote);
  const [draft, setDraft] = useState(strategy.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (editing) {
    return (
      <div className="strat-note-editor">
        <p className="strat-note-hint">
          Nhận định riêng của bạn — hỗ trợ markdown: <code>**đậm**</code>, <code>- danh sách</code>, bảng.
        </p>
        <textarea
          className="strat-note-textarea"
          rows={10}
          value={draft}
          placeholder="Ví dụ: chỉ vào lệnh QQE D1 khi trùng vùng hỗ trợ tuần; bỏ qua H4; TP +10% vì +15% chỉ ~43%…"
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        {error && <p className="trade-form-error">{error}</p>}
        <div className="strat-note-actions">
          <button className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            {saving ? 'Đang lưu…' : '💾 Lưu ghi chú'}
          </button>
          {hasNote && (
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setDraft(strategy.note ?? '');
                setEditing(false);
              }}
              disabled={saving}
            >
              Huỷ
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="strat-note-view">
      <div className="strat-note-view-head">
        <span className="strat-note-view-label">Cập nhật {fmtDate(strategy.updatedAt)}</span>
        <button className="btn btn--ghost btn--sm" onClick={startEdit}>
          ✎ Sửa
        </button>
      </div>
      <div
        className="strat-detail-content--md strat-note-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(strategy.note ?? '') }}
      />
    </div>
  );
}
