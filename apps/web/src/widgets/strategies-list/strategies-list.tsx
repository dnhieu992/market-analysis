'use client';

import type { TradingStrategy } from '@web/shared/api/types';

import { StrategiesCardGrid } from './strategies-card-grid';
import { StrategiesSplit } from './strategies-split';

type StrategiesListProps = Readonly<{
  strategies: TradingStrategy[];
  selectedId: string | null;
}>;

export function StrategiesList({ strategies, selectedId }: StrategiesListProps) {
  return (
    <main className="dashboard-shell">
      {/* Desktop: split layout (hidden on mobile via CSS) */}
      <div className="strat-split-wrapper">
        <StrategiesSplit strategies={strategies} selectedId={selectedId} />
      </div>

      {/* Mobile: card grid (hidden on desktop via CSS) */}
      <div className="sgrid-wrapper">
        <StrategiesCardGrid strategies={strategies} />
      </div>
    </main>
  );
}
