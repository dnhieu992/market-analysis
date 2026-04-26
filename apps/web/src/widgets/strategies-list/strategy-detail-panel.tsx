'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { EditStrategyForm } from '@web/features/edit-strategy/edit-strategy-form';
import { createApiClient } from '@web/shared/api/client';
import type { TradingStrategy } from '@web/shared/api/types';

type StrategyDetailPanelProps = Readonly<{
  strategy: TradingStrategy;
}>;

export function StrategyDetailPanel({ strategy }: StrategyDetailPanelProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleConfirmDelete() {
    try {
      await createApiClient().deleteTradingStrategy(strategy.id);
      setDeleteOpen(false);
      startTransition(() => {
        router.push('/strategy');
        router.refresh();
      });
    } catch {
      // stay open so user can retry
    }
  }

  return (
    <>
      <div className="strat-detail">
        <h2 className="strat-detail-name">{strategy.name}</h2>

        <div className="strat-detail-meta">
          <span className="strat-ver-badge">{strategy.version}</span>
          <span className="strat-detail-date">
            Created {new Date(strategy.createdAt).toLocaleDateString()}
          </span>
        </div>

        <p className="strat-detail-content">{strategy.content}</p>

        <div className="strat-detail-actions">
          <button className="btn btn--secondary" onClick={() => setEditOpen(true)}>
            Edit
          </button>
          <button className="btn btn--danger" onClick={() => setDeleteOpen(true)}>
            Delete
          </button>
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
