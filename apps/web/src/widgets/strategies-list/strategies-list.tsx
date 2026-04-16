'use client';

import { useState, useTransition } from 'react';

import { CreateStrategyForm } from '@web/features/create-strategy/create-strategy-form';
import { EditStrategyForm } from '@web/features/edit-strategy/edit-strategy-form';
import { createApiClient } from '@web/shared/api/client';
import type { TradingStrategy } from '@web/shared/api/types';

import { StrategiesTable } from './strategies-table';

type StrategiesListProps = Readonly<{
  strategies: TradingStrategy[];
}>;

export function StrategiesList({ strategies }: StrategiesListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editStrategy, setEditStrategy] = useState<TradingStrategy | null>(null);
  const [deleteStrategyId, setDeleteStrategyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleConfirmDelete() {
    if (!deleteStrategyId) return;
    try {
      await createApiClient().deleteTradingStrategy(deleteStrategyId);
      setDeleteStrategyId(null);
      startTransition(() => { window.location.reload(); });
    } catch {
      // ignore — page will stay open so user can retry
    }
  }

  return (
    <main className="dashboard-shell trades-shell">
      <StrategiesTable
        strategies={strategies}
        onAddStrategy={() => setCreateOpen(true)}
        onEditStrategy={(s) => setEditStrategy(s)}
        onRemoveStrategy={(id) => setDeleteStrategyId(id)}
      />

      {/* Create dialog */}
      {createOpen && (
        <div className="dialog-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Add Strategy</span>
              <button className="dialog-close" onClick={() => setCreateOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CreateStrategyForm onSubmitted={() => setCreateOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Edit dialog */}
      {editStrategy && (
        <div className="dialog-backdrop" onClick={() => setEditStrategy(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Edit Strategy — {editStrategy.name}</span>
              <button className="dialog-close" onClick={() => setEditStrategy(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <EditStrategyForm strategy={editStrategy} onSubmitted={() => setEditStrategy(null)} />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteStrategyId && (
        <div className="dialog-backdrop" onClick={() => setDeleteStrategyId(null)}>
          <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Delete Strategy</span>
              <button className="dialog-close" onClick={() => setDeleteStrategyId(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-confirm-text">Are you sure you want to delete this strategy? This action cannot be undone.</p>
              <div className="dialog-confirm-actions">
                <button className="btn btn--secondary" onClick={() => setDeleteStrategyId(null)}>Cancel</button>
                <button className="btn btn--danger" onClick={handleConfirmDelete} disabled={isPending}>
                  {isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
