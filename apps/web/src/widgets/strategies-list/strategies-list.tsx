'use client';

import { useState } from 'react';

import { CreateStrategyForm } from '@web/features/create-strategy/create-strategy-form';
import type { TradingStrategy } from '@web/shared/api/types';

import { StrategiesCardGrid } from './strategies-card-grid';
import { StrategiesSplit } from './strategies-split';

type StrategiesListProps = Readonly<{
  strategies: TradingStrategy[];
  selectedId: string | null;
}>;

export function StrategiesList({ strategies, selectedId }: StrategiesListProps) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <main className="dashboard-shell">
      {/* Desktop: split layout (hidden on mobile via CSS) */}
      <StrategiesSplit
        strategies={strategies}
        selectedId={selectedId}
        onCreateClick={() => setCreateOpen(true)}
      />

      {/* Mobile: card grid (hidden on desktop via CSS) */}
      <StrategiesCardGrid
        strategies={strategies}
        onCreateClick={() => setCreateOpen(true)}
      />

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
    </main>
  );
}
