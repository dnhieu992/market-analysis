'use client';

import { useRouter } from 'next/navigation';

import type { TradingStrategy } from '@web/shared/api/types';

import { StrategyDetailPanel } from './strategy-detail-panel';

type StrategiesSplitProps = Readonly<{
  strategies: TradingStrategy[];
  selectedId: string | null;
}>;

export function StrategiesSplit({ strategies, selectedId }: StrategiesSplitProps) {
  const router = useRouter();
  // Default to the first strategy when the URL has no (or an unknown) id, so the
  // panel is never empty while strategies exist.
  const selected =
    strategies.find((s) => s.id === selectedId) ?? strategies[0] ?? null;

  function selectStrategy(id: string) {
    router.push(`/strategy?id=${id}`);
  }

  return (
    <div className="strat-page">
      <div className="strat-page-header">
        <h1 className="strat-page-title">Strategy Analysis</h1>
      </div>

      {/* Strategy selector — chip buttons on the first row */}
      {strategies.length > 0 && (
        <div className="strat-chip-row" role="tablist" aria-label="Chọn chiến lược">
          {strategies.map((strategy) => (
            <button
              key={strategy.id}
              role="tab"
              aria-selected={strategy.id === selected?.id}
              className={`strat-chip${strategy.id === selected?.id ? ' strat-chip--active' : ''}`}
              onClick={() => selectStrategy(strategy.id)}
            >
              <span className="strat-chip-name">{strategy.name}</span>
              <span className="strat-chip-ver">v{strategy.version}</span>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <StrategyDetailPanel key={selected.id} strategy={selected} />
      ) : (
        <div className="strat-detail-placeholder">
          No strategies yet. Add one to get started.
        </div>
      )}
    </div>
  );
}
